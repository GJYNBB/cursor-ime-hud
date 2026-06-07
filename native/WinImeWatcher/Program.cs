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
    private static bool _imeContextFailureLogged;

    public static async Task<int> Main(string[] args)
    {
        Console.OutputEncoding = Encoding.UTF8;

        WriteHello();

        var once = args.Any(static argument => string.Equals(argument, "--once", StringComparison.OrdinalIgnoreCase));
        if (once)
        {
            EmitSnapshot(force: true);
            return 0;
        }

        var cancellationTokenSource = new CancellationTokenSource();
        ConsoleCancelEventHandler cancelHandler = (_, eventArgs) =>
        {
            eventArgs.Cancel = true;
            try
            {
                cancellationTokenSource.Cancel();
            }
            catch (ObjectDisposedException)
            {
                // CTS already disposed; nothing to do.
            }
        };
        Console.CancelKeyPress += cancelHandler;

        try
        {
            var inputTask = Task.Run(() => ReadCommandsAsync(cancellationTokenSource), cancellationTokenSource.Token);

            EmitSnapshot(force: true);

            if (_lastSnapshot is { State: "unknown" })
            {
                WriteLog(
                    "warn",
                    "Initial probe returned unknown. Continuing to watch because unknown can be a valid Electron/IME state.",
                    new { _lastSnapshot.Reason });
            }

            try
            {
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
        finally
        {
            Console.CancelKeyPress -= cancelHandler;
            cancellationTokenSource.Dispose();
        }
    }

    private static void WriteHello()
    {
        WriteJson(new
        {
            type = "hello",
            version = ProtocolVersion,
            capabilities = new[] { "state", "log" }
        }, standardError: false);
    }

    private const int ProtocolVersion = 1;

    private static async Task ReadCommandsAsync(CancellationTokenSource shutdownSource)
    {
        var cancellationToken = shutdownSource.Token;
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                var line = await Console.In.ReadLineAsync(cancellationToken);
                if (line is null)
                {
                    WriteLog("info", "WinImeWatcher stdin closed. Shutting down.");
                    shutdownSource.Cancel();
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
            snapshot = BuildProbeFailedSnapshot(exception);
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
            hwnd = snapshot.Hwnd,
            reason = snapshot.Reason,
            confidence = snapshot.Confidence,
            rawStateAvailable = snapshot.RawStateAvailable
        }, standardError: false);
    }

    private static ProbeSnapshot BuildProbeFailedSnapshot(Exception exception)
    {
        if (_lastSnapshot is { } previous)
        {
            return previous with
            {
                State = "unknown",
                Reason = "probe-failed",
                Confidence = 0,
                RawStateAvailable = false,
                Timestamp = DateTimeOffset.UtcNow
            };
        }

        return new ProbeSnapshot(
            State: "unknown",
            ImeName: null,
            IsOpen: null,
            LayoutHex: null,
            ThreadId: null,
            Hwnd: null,
            Timestamp: DateTimeOffset.UtcNow,
            Reason: "probe-failed",
            Confidence: 0,
            RawStateAvailable: false
        );
    }

    private static ProbeSnapshot ProbeCurrentState()
    {
        var foregroundWindow = NativeMethods.GetForegroundWindow();
        if (foregroundWindow == IntPtr.Zero)
        {
            return CreateUnknownSnapshot(reason: "foreground-window-missing", confidence: 0, rawStateAvailable: false);
        }

        var threadId = NativeMethods.GetWindowThreadProcessId(foregroundWindow, out _);
        if (threadId == 0)
        {
            return CreateUnknownSnapshot(
                reason: "thread-id-missing",
                confidence: 0,
                rawStateAvailable: false,
                hwnd: FormatHandle(foregroundWindow));
        }

        var guiThreadInfo = new NativeMethods.GuiThreadInfo
        {
            cbSize = Marshal.SizeOf<NativeMethods.GuiThreadInfo>()
        };

        var hasGuiThreadInfo = NativeMethods.GetGUIThreadInfo(threadId, ref guiThreadInfo);
        var focusHandle = hasGuiThreadInfo && guiThreadInfo.hwndFocus != IntPtr.Zero
            ? guiThreadInfo.hwndFocus
            : hasGuiThreadInfo && guiThreadInfo.hwndActive != IntPtr.Zero
                ? guiThreadInfo.hwndActive
                : foregroundWindow;
        var focusThreadId = NativeMethods.GetWindowThreadProcessId(focusHandle, out _);
        if (focusThreadId != 0)
        {
            threadId = focusThreadId;
        }

        var keyboardLayout = NativeMethods.GetKeyboardLayout(threadId);
        if (keyboardLayout == IntPtr.Zero)
        {
            return CreateUnknownSnapshot(
                reason: "keyboard-layout-missing",
                confidence: 0,
                rawStateAvailable: false,
                threadId: threadId,
                hwnd: FormatHandle(focusHandle));
        }

        var layoutHex = $"0x{keyboardLayout.ToInt64():X}";
        if (!TryResolveIsChineseLayout(keyboardLayout, out var isChineseLayout))
        {
            return CreateUnknownSnapshot(
                reason: "keyboard-layout-unrecognized",
                confidence: 0,
                rawStateAvailable: false,
                layoutHex: layoutHex,
                threadId: threadId,
                hwnd: FormatHandle(focusHandle));
        }

        var imeName = GetImeDescription(keyboardLayout);
        IntPtr inputContext;
        try
        {
            inputContext = NativeMethods.ImmGetContext(focusHandle);
        }
        catch (Exception imeException)
        {
            if (!_imeContextFailureLogged)
            {
                _imeContextFailureLogged = true;
                WriteLog(
                    "warn",
                    "ImmGetContext threw on probe thread. Trying default IME window fallback.",
                    new { error = imeException.Message });
            }

            if (TryGetOpenStatusFromDefaultImeWindow(focusHandle, foregroundWindow, out var fallbackIsOpen, out var fallbackImeWindow))
            {
                return BuildSnapshotFromOpenStatus(
                    isChineseLayout,
                    fallbackIsOpen,
                    imeName,
                    layoutHex,
                    threadId,
                    focusHandle,
                    $"default-ime-window-{fallbackImeWindow}-after-context-error",
                    0.85);
            }

            return CreateUnknownSnapshot(
                reason: "ime-context-error",
                confidence: 0,
                rawStateAvailable: false,
                imeName: imeName,
                layoutHex: layoutHex,
                threadId: threadId,
                hwnd: FormatHandle(focusHandle));
        }

        if (inputContext == IntPtr.Zero)
        {
            if (!_imeContextFailureLogged)
            {
                _imeContextFailureLogged = true;
                WriteLog(
                    "warn",
                    "ImmGetContext returned a null handle. Trying default IME window fallback.",
                    new { threadId });
            }

            if (TryGetOpenStatusFromDefaultImeWindow(focusHandle, foregroundWindow, out var fallbackIsOpen, out var fallbackImeWindow))
            {
                return BuildSnapshotFromOpenStatus(
                    isChineseLayout,
                    fallbackIsOpen,
                    imeName,
                    layoutHex,
                    threadId,
                    focusHandle,
                    $"default-ime-window-{fallbackImeWindow}-after-null-context",
                    0.85);
            }

            return CreateUnknownSnapshot(
                reason: "ime-context-missing",
                confidence: 0,
                rawStateAvailable: false,
                imeName: imeName,
                layoutHex: layoutHex,
                threadId: threadId,
                hwnd: FormatHandle(focusHandle));
        }

        bool isOpen;
        try
        {
            isOpen = NativeMethods.ImmGetOpenStatus(inputContext);
        }
        finally
        {
            NativeMethods.ImmReleaseContext(focusHandle, inputContext);
        }

        if (isChineseLayout)
        {
            return new ProbeSnapshot(
                State: isOpen ? "cn" : "en",
                ImeName: imeName,
                IsOpen: isOpen,
                LayoutHex: layoutHex,
                ThreadId: threadId,
                Hwnd: FormatHandle(focusHandle),
                Timestamp: DateTimeOffset.UtcNow,
                Reason: isOpen ? "confirmed-open-chinese-layout" : "confirmed-closed-chinese-layout",
                Confidence: 1.0,
                RawStateAvailable: true
            );
        }

        if (!isOpen)
        {
            return new ProbeSnapshot(
                State: "en",
                ImeName: imeName,
                IsOpen: isOpen,
                LayoutHex: layoutHex,
                ThreadId: threadId,
                Hwnd: FormatHandle(focusHandle),
                Timestamp: DateTimeOffset.UtcNow,
                Reason: "confirmed-closed-non-chinese-layout",
                Confidence: 1.0,
                RawStateAvailable: true
            );
        }

        return CreateUnknownSnapshot(
            reason: "open-non-chinese-layout-conflict",
            confidence: 0.25,
            rawStateAvailable: true,
            imeName: imeName,
            isOpen: isOpen,
            layoutHex: layoutHex,
            threadId: threadId,
            hwnd: FormatHandle(focusHandle));
    }

    private static ProbeSnapshot BuildSnapshotFromOpenStatus(
        bool isChineseLayout,
        bool isOpen,
        string? imeName,
        string layoutHex,
        uint threadId,
        IntPtr focusHandle,
        string reasonPrefix,
        double confidence)
    {
        if (isChineseLayout)
        {
            return new ProbeSnapshot(
                State: isOpen ? "cn" : "en",
                ImeName: imeName,
                IsOpen: isOpen,
                LayoutHex: layoutHex,
                ThreadId: threadId,
                Hwnd: FormatHandle(focusHandle),
                Timestamp: DateTimeOffset.UtcNow,
                Reason: isOpen ? $"{reasonPrefix}-open-chinese-layout" : $"{reasonPrefix}-closed-chinese-layout",
                Confidence: confidence,
                RawStateAvailable: true
            );
        }

        if (!isOpen)
        {
            return new ProbeSnapshot(
                State: "en",
                ImeName: imeName,
                IsOpen: isOpen,
                LayoutHex: layoutHex,
                ThreadId: threadId,
                Hwnd: FormatHandle(focusHandle),
                Timestamp: DateTimeOffset.UtcNow,
                Reason: $"{reasonPrefix}-closed-non-chinese-layout",
                Confidence: confidence,
                RawStateAvailable: true
            );
        }

        return CreateUnknownSnapshot(
            reason: $"{reasonPrefix}-open-non-chinese-layout-conflict",
            confidence: 0.25,
            rawStateAvailable: true,
            imeName: imeName,
            isOpen: isOpen,
            layoutHex: layoutHex,
            threadId: threadId,
            hwnd: FormatHandle(focusHandle));
    }

    private static bool TryGetOpenStatusFromDefaultImeWindow(
        IntPtr focusHandle,
        IntPtr foregroundWindow,
        out bool isOpen,
        out string? imeWindow)
    {
        isOpen = false;
        imeWindow = null;

        foreach (var ownerHandle in new[] { focusHandle, foregroundWindow })
        {
            if (ownerHandle == IntPtr.Zero)
            {
                continue;
            }

            var defaultImeWindow = NativeMethods.ImmGetDefaultIMEWnd(ownerHandle);
            if (defaultImeWindow == IntPtr.Zero)
            {
                continue;
            }

            var sendResult = NativeMethods.SendMessageTimeoutW(
                defaultImeWindow,
                NativeMethods.WM_IME_CONTROL,
                new UIntPtr(NativeMethods.IMC_GETOPENSTATUS),
                IntPtr.Zero,
                NativeMethods.SMTO_ABORTIFHUNG | NativeMethods.SMTO_BLOCK,
                100,
                out var openStatusResult);

            if (sendResult == IntPtr.Zero)
            {
                continue;
            }

            isOpen = openStatusResult != IntPtr.Zero;
            imeWindow = FormatHandle(defaultImeWindow);
            return true;
        }

        return false;
    }

    private static string? GetImeDescription(IntPtr keyboardLayout)
    {
        var builder = new StringBuilder(256);
        var length = NativeMethods.ImmGetDescriptionW(keyboardLayout, builder, (uint)builder.Capacity);
        if (length == 0)
        {
            return null;
        }

        var description = builder.ToString().Trim();
        return description.Length == 0 ? null : description;
    }

    private static bool TryResolveIsChineseLayout(IntPtr keyboardLayout, out bool isChineseLayout)
    {
        var lowWord = (ushort)((ulong)keyboardLayout.ToInt64() & 0xFFFF);
        var primaryLanguageId = lowWord & 0x03FF;
        if (primaryLanguageId == 0)
        {
            isChineseLayout = false;
            return false;
        }

        isChineseLayout = primaryLanguageId == 0x0004;
        return true;
    }

    private static ProbeSnapshot CreateUnknownSnapshot(
        string reason,
        double confidence,
        bool rawStateAvailable,
        string? imeName = null,
        bool? isOpen = null,
        string? layoutHex = null,
        uint? threadId = null,
        string? hwnd = null)
    {
        return new ProbeSnapshot(
            State: "unknown",
            ImeName: imeName,
            IsOpen: isOpen,
            LayoutHex: layoutHex,
            ThreadId: threadId,
            Hwnd: hwnd,
            Timestamp: DateTimeOffset.UtcNow,
            Reason: reason,
            Confidence: confidence,
            RawStateAvailable: rawStateAvailable
        );
    }

    private static string FormatHandle(IntPtr handle)
    {
        return $"0x{handle.ToInt64():X}";
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
        DateTimeOffset Timestamp,
        string Reason,
        double Confidence,
        bool RawStateAvailable
    ) : IEquatable<ProbeSnapshot>
    {
        public bool Equals(ProbeSnapshot? other)
        {
            if (other is null)
            {
                return false;
            }

            if (ReferenceEquals(this, other))
            {
                return true;
            }

            return State == other.State
                && ImeName == other.ImeName
                && IsOpen == other.IsOpen
                && LayoutHex == other.LayoutHex
                && ThreadId == other.ThreadId
                && Hwnd == other.Hwnd
                && Reason == other.Reason
                && Confidence.Equals(other.Confidence)
                && RawStateAvailable == other.RawStateAvailable;
        }

        public override int GetHashCode()
        {
            return HashCode.Combine(
                HashCode.Combine(
                    State,
                    ImeName,
                    IsOpen,
                    LayoutHex,
                    ThreadId,
                    Hwnd,
                    Reason,
                    Confidence),
                RawStateAvailable);
        }
    }

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

        internal const uint WM_IME_CONTROL = 0x0283;
        internal const uint IMC_GETOPENSTATUS = 0x0005;
        internal const uint SMTO_ABORTIFHUNG = 0x0002;
        internal const uint SMTO_BLOCK = 0x0001;

        [DllImport("imm32.dll")]
        internal static extern IntPtr ImmGetContext(IntPtr hWnd);

        [DllImport("imm32.dll")]
        internal static extern IntPtr ImmGetDefaultIMEWnd(IntPtr hWnd);

        [DllImport("user32.dll", SetLastError = true)]
        internal static extern IntPtr SendMessageTimeoutW(
            IntPtr hWnd,
            uint msg,
            UIntPtr wParam,
            IntPtr lParam,
            uint fuFlags,
            uint uTimeout,
            out IntPtr lpdwResult);

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
