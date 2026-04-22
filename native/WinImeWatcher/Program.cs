using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace WinImeWatcher;

internal static class Program
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    private static readonly object OutputLock = new();
    private static ProbeSnapshot? _lastSnapshot;

    public static async Task<int> Main(string[] args)
    {
        Console.OutputEncoding = Encoding.UTF8;

        var once = args.Any(static argument => string.Equals(argument, "--once", StringComparison.OrdinalIgnoreCase));
        if (once)
        {
            EmitSnapshot(force: true);
            return 0;
        }

        using var cancellationTokenSource = new CancellationTokenSource();
        Console.CancelKeyPress += (_, eventArgs) =>
        {
            eventArgs.Cancel = true;
            cancellationTokenSource.Cancel();
        };

        var inputTask = Task.Run(() => ReadCommandsAsync(cancellationTokenSource.Token), cancellationTokenSource.Token);

        try
        {
            EmitSnapshot(force: true);

            using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(250));
            while (await timer.WaitForNextTickAsync(cancellationTokenSource.Token))
            {
                EmitSnapshot(force: false);
            }
        }
        catch (OperationCanceledException)
        {
            WriteLog("info", "WinImeWatcher cancellation requested.");
        }
        catch (Exception exception)
        {
            WriteLog("error", "Unhandled watcher exception.", new { error = exception.Message, exception.StackTrace });
            return 1;
        }

        await inputTask;
        return 0;
    }

    private static async Task ReadCommandsAsync(CancellationToken cancellationToken)
    {
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                var line = await Console.In.ReadLineAsync(cancellationToken);
                if (line is null)
                {
                    break;
                }

                if (string.IsNullOrWhiteSpace(line))
                {
                    continue;
                }

                CommandMessage? command;
                try
                {
                    command = JsonSerializer.Deserialize<CommandMessage>(line, JsonOptions);
                }
                catch (Exception exception)
                {
                    WriteLog("warn", "Failed to parse command JSON.", new { line, error = exception.Message });
                    continue;
                }

                if (string.Equals(command?.Command, "refresh", StringComparison.OrdinalIgnoreCase))
                {
                    EmitSnapshot(force: true);
                }
            }
        }
        catch (OperationCanceledException)
        {
            // Normal shutdown.
        }
    }

    private static void EmitSnapshot(bool force)
    {
        ProbeSnapshot snapshot;
        try
        {
            snapshot = ProbeCurrentState();
        }
        catch (Exception exception)
        {
            snapshot = new ProbeSnapshot(
                State: "unknown",
                ImeName: null,
                IsOpen: null,
                LayoutHex: null,
                ThreadId: null,
                Hwnd: null,
                Timestamp: DateTimeOffset.UtcNow
            );
            WriteLog("error", "Failed to probe IME state.", new { error = exception.Message, exception.StackTrace });
        }

        if (!force && Equals(_lastSnapshot, snapshot))
        {
            return;
        }

        _lastSnapshot = snapshot;
        WriteJson(new
        {
            type = "state",
            state = snapshot.State,
            imeName = snapshot.ImeName,
            timestamp = snapshot.Timestamp.ToString("O"),
            source = "native-helper",
            isOpen = snapshot.IsOpen,
            layoutHex = snapshot.LayoutHex,
            threadId = snapshot.ThreadId,
            hwnd = snapshot.Hwnd
        }, standardError: false);
    }

    private static ProbeSnapshot ProbeCurrentState()
    {
        var foregroundWindow = NativeMethods.GetForegroundWindow();
        if (foregroundWindow == IntPtr.Zero)
        {
            return CreateUnknownSnapshot();
        }

        var threadId = NativeMethods.GetWindowThreadProcessId(foregroundWindow, out _);
        if (threadId == 0)
        {
            return CreateUnknownSnapshot();
        }

        var guiThreadInfo = new NativeMethods.GuiThreadInfo
        {
            cbSize = Marshal.SizeOf<NativeMethods.GuiThreadInfo>()
        };

        var hasGuiThreadInfo = NativeMethods.GetGUIThreadInfo(threadId, ref guiThreadInfo);
        var focusHandle = hasGuiThreadInfo && guiThreadInfo.hwndFocus != IntPtr.Zero
            ? guiThreadInfo.hwndFocus
            : foregroundWindow;

        var keyboardLayout = NativeMethods.GetKeyboardLayout(threadId);
        var layoutHex = $"0x{keyboardLayout.ToInt64():X}";
        var imeName = GetImeDescription(keyboardLayout);
        var isChineseLayout = IsChineseLayout(keyboardLayout);

        bool? isOpen = null;
        var inputContext = focusHandle != IntPtr.Zero ? NativeMethods.ImmGetContext(focusHandle) : IntPtr.Zero;
        if (inputContext != IntPtr.Zero)
        {
            isOpen = NativeMethods.ImmGetOpenStatus(inputContext);
            NativeMethods.ImmReleaseContext(focusHandle, inputContext);
        }

        var state = isChineseLayout && isOpen == true ? "cn" : "en";

        return new ProbeSnapshot(
            State: state,
            ImeName: string.IsNullOrWhiteSpace(imeName) ? null : imeName,
            IsOpen: isOpen,
            LayoutHex: layoutHex,
            ThreadId: threadId,
            Hwnd: $"0x{focusHandle.ToInt64():X}",
            Timestamp: DateTimeOffset.UtcNow
        );
    }

    private static string? GetImeDescription(IntPtr keyboardLayout)
    {
        var builder = new StringBuilder(256);
        _ = NativeMethods.ImmGetDescriptionW(keyboardLayout, builder, (uint)builder.Capacity);
        return builder.ToString();
    }

    private static bool IsChineseLayout(IntPtr keyboardLayout)
    {
        var lowWord = (ushort)((ulong)keyboardLayout.ToInt64() & 0xFFFF);
        var primaryLanguageId = lowWord & 0x03FF;
        return primaryLanguageId == 0x0004;
    }

    private static ProbeSnapshot CreateUnknownSnapshot()
    {
        return new ProbeSnapshot(
            State: "unknown",
            ImeName: null,
            IsOpen: null,
            LayoutHex: null,
            ThreadId: null,
            Hwnd: null,
            Timestamp: DateTimeOffset.UtcNow
        );
    }

    private static void WriteLog(string level, string message, object? details = null)
    {
        WriteJson(new
        {
            type = "log",
            level,
            timestamp = DateTimeOffset.UtcNow.ToString("O"),
            message,
            details,
            source = "native-helper"
        }, standardError: true);
    }

    private static void WriteJson(object payload, bool standardError)
    {
        var text = JsonSerializer.Serialize(payload, JsonOptions);
        lock (OutputLock)
        {
            if (standardError)
            {
                Console.Error.WriteLine(text);
                Console.Error.Flush();
            }
            else
            {
                Console.Out.WriteLine(text);
                Console.Out.Flush();
            }
        }
    }

    private sealed record CommandMessage(string? Command);

    private sealed record ProbeSnapshot(
        string State,
        string? ImeName,
        bool? IsOpen,
        string? LayoutHex,
        uint? ThreadId,
        string? Hwnd,
        DateTimeOffset Timestamp
    );

    private static class NativeMethods
    {
        [StructLayout(LayoutKind.Sequential)]
        internal struct Rect
        {
            public int left;
            public int top;
            public int right;
            public int bottom;
        }

        [StructLayout(LayoutKind.Sequential)]
        internal struct GuiThreadInfo
        {
            public int cbSize;
            public int flags;
            public IntPtr hwndActive;
            public IntPtr hwndFocus;
            public IntPtr hwndCapture;
            public IntPtr hwndMenuOwner;
            public IntPtr hwndMoveSize;
            public Rect rcCaret;
        }

        [DllImport("user32.dll")]
        internal static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        internal static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool GetGUIThreadInfo(uint idThread, ref GuiThreadInfo lpgui);

        [DllImport("user32.dll")]
        internal static extern IntPtr GetKeyboardLayout(uint idThread);

        [DllImport("imm32.dll")]
        internal static extern IntPtr ImmGetContext(IntPtr hWnd);

        [DllImport("imm32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool ImmReleaseContext(IntPtr hWnd, IntPtr hIMC);

        [DllImport("imm32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool ImmGetOpenStatus(IntPtr hIMC);

        [DllImport("imm32.dll", CharSet = CharSet.Unicode)]
        internal static extern uint ImmGetDescriptionW(IntPtr hKl, StringBuilder lpszDescription, uint uBufLen);
    }
}
