#include <napi.h>
#include <windows.h>
#include <UIAutomation.h>
#include "explorer_context.h"
#include "shell_actions.h"

#include <atomic>
#include <condition_variable>
#include <memory>
#include <mutex>
#include <string>
#include <thread>

namespace {

constexpr UINT kWakeMessage = WM_APP + 1;

struct MouseEvent {
  std::string kind;
  unsigned int sequence = 0;
  LONG_PTR window = 0;
  LONG x = 0;
  LONG y = 0;
  std::string name;
};

struct Bounds {
  std::atomic<LONG> left{0};
  std::atomic<LONG> top{0};
  std::atomic<LONG> right{0};
  std::atomic<LONG> bottom{0};
};

std::atomic<bool> running{false};
std::atomic<bool> enabled{true};
std::atomic<bool> pauseInFullscreen{false};
std::atomic<bool> copyCancellationRequested{false};
std::atomic<bool> visible{false};
std::atomic<bool> swallowRightUp{false};
std::atomic<unsigned int> gestureSequence{0};
std::atomic<unsigned int> activeGesture{0};
std::atomic<ULONGLONG> lastMoveTick{0};
std::atomic<DWORD> hookThreadId{0};
Bounds bounds;
HHOOK mouseHook = nullptr;
std::thread hookThread;
std::mutex startupMutex;
std::condition_variable startupReady;
bool startupFinished = false;
Napi::ThreadSafeFunction callback;

void Emit(std::unique_ptr<MouseEvent> event) {
  auto* raw = event.release();
  napi_status status = callback.NonBlockingCall(raw, [](Napi::Env env, Napi::Function fn, MouseEvent* data) {
    Napi::Object value = Napi::Object::New(env);
    value.Set("kind", data->kind);
    value.Set("sequence", data->sequence);
    value.Set("window", static_cast<double>(data->window));
    value.Set("x", data->x);
    value.Set("y", data->y);
    value.Set("name", data->name);
    fn.Call({value});
    delete data;
  });
  if (status != napi_ok) delete raw;
}

std::string HoveredName(POINT point) {
  std::string name;
  if (FAILED(CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED))) return name;

  IUIAutomation* automation = nullptr;
  if (SUCCEEDED(CoCreateInstance(CLSID_CUIAutomation, nullptr, CLSCTX_INPROC_SERVER,
                                 IID_IUIAutomation, reinterpret_cast<void**>(&automation)))) {
    IUIAutomationElement* element = nullptr;
    if (SUCCEEDED(automation->ElementFromPoint(point, &element))) {
      IUIAutomationTreeWalker* walker = nullptr;
      automation->get_ControlViewWalker(&walker);
      for (int level = 0; element && level < 6; ++level) {
        CONTROLTYPEID type = 0;
        element->get_CurrentControlType(&type);
        if (type == UIA_ListItemControlTypeId || type == UIA_DataItemControlTypeId) {
          BSTR label = nullptr;
          if (SUCCEEDED(element->get_CurrentName(&label)) && label) {
            int length = WideCharToMultiByte(CP_UTF8, 0, label, -1, nullptr, 0, nullptr, nullptr);
            if (length > 1) {
              name.resize(length);
              WideCharToMultiByte(CP_UTF8, 0, label, -1, name.data(), length, nullptr, nullptr);
              name.pop_back();
            }
            SysFreeString(label);
          }
          break;
        }
        IUIAutomationElement* parent = nullptr;
        if (walker) walker->GetParentElement(element, &parent);
        element->Release();
        element = parent;
      }
      if (element) element->Release();
      if (walker) walker->Release();
    }
    automation->Release();
  }
  CoUninitialize();
  return name;
}

bool IsFullscreenWindow(HWND window) {
  if (!window || !IsWindowVisible(window) || IsIconic(window)) return false;
  wchar_t className[64]{};
  GetClassNameW(window, className, 64);
  if (wcscmp(className, L"Progman") == 0 || wcscmp(className, L"WorkerW") == 0 ||
      wcscmp(className, L"Shell_TrayWnd") == 0) return false;

  const LONG_PTR style = GetWindowLongPtrW(window, GWL_STYLE);
  if ((style & WS_MAXIMIZE) && (style & (WS_CAPTION | WS_THICKFRAME))) return false;
  RECT windowRect{};
  if (!GetWindowRect(window, &windowRect)) return false;
  MONITORINFO monitorInfo{};
  monitorInfo.cbSize = sizeof(monitorInfo);
  if (!GetMonitorInfoW(MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST), &monitorInfo)) return false;
  const RECT& monitor = monitorInfo.rcMonitor;
  constexpr LONG tolerance = 2;
  return windowRect.left <= monitor.left + tolerance &&
         windowRect.top <= monitor.top + tolerance &&
         windowRect.right >= monitor.right - tolerance &&
         windowRect.bottom >= monitor.bottom - tolerance;
}

LRESULT CALLBACK OnMouse(int code, WPARAM message, LPARAM data) {
  if (code >= 0) {
    const auto* mouse = reinterpret_cast<MSLLHOOKSTRUCT*>(data);
    if (visible && (message == WM_LBUTTONDOWN || message == WM_RBUTTONDOWN)) {
      const POINT point = mouse->pt;
      if (point.x < bounds.left || point.x >= bounds.right ||
          point.y < bounds.top || point.y >= bounds.bottom) {
        visible = false;
        auto event = std::make_unique<MouseEvent>();
        event->kind = "dismiss";
        Emit(std::move(event));
      }
    }

    if (enabled && message == WM_RBUTTONDOWN && (GetAsyncKeyState(VK_MENU) & 0x8000)) {
      const POINT point = mouse->pt;
      HWND target = WindowFromPoint(point);
      HWND root = target ? GetAncestor(target, GA_ROOT) : GetForegroundWindow();
      if (pauseInFullscreen && IsFullscreenWindow(root)) return CallNextHookEx(mouseHook, code, message, data);
      swallowRightUp = true;
      const unsigned int sequence = ++gestureSequence;
      activeGesture = sequence;
      const LONG_PTR window = reinterpret_cast<LONG_PTR>(root);
      auto press = std::make_unique<MouseEvent>();
      press->kind = "press";
      press->sequence = sequence;
      press->x = point.x;
      press->y = point.y;
      Emit(std::move(press));
      if (callback.Acquire() == napi_ok) {
        std::thread([point, window, sequence] {
          auto event = std::make_unique<MouseEvent>();
          event->kind = "open";
          event->sequence = sequence;
          event->window = window;
          event->x = point.x;
          event->y = point.y;
          event->name = HoveredName(point);
          Emit(std::move(event));
          callback.Release();
        }).detach();
      }
      return 1;
    }

    if (message == WM_MOUSEMOVE && activeGesture) {
      const ULONGLONG now = GetTickCount64();
      if (now - lastMoveTick.exchange(now) >= 16) {
        auto event = std::make_unique<MouseEvent>();
        event->kind = "move";
        event->sequence = activeGesture;
        event->x = mouse->pt.x;
        event->y = mouse->pt.y;
        Emit(std::move(event));
      }
    }

    if (message == WM_RBUTTONUP && swallowRightUp.exchange(false)) {
      auto event = std::make_unique<MouseEvent>();
      event->kind = "release";
      event->sequence = activeGesture.exchange(0);
      event->x = mouse->pt.x;
      event->y = mouse->pt.y;
      Emit(std::move(event));
      return 1;
    }
  }
  return CallNextHookEx(mouseHook, code, message, data);
}

Napi::Value Start(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (running) return Napi::Boolean::New(env, true);
  if (info.Length() != 1 || !info[0].IsFunction()) {
    Napi::TypeError::New(env, "Expected an event callback").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  callback = Napi::ThreadSafeFunction::New(env, info[0].As<Napi::Function>(), "mouse bridge", 0, 1);
  running = true;
  {
    std::lock_guard<std::mutex> lock(startupMutex);
    startupFinished = false;
  }
  hookThread = std::thread([] {
    MSG message;
    PeekMessage(&message, nullptr, 0, 0, PM_NOREMOVE);
    hookThreadId = GetCurrentThreadId();
    mouseHook = SetWindowsHookExW(WH_MOUSE_LL, OnMouse, GetModuleHandleW(nullptr), 0);
    {
      std::lock_guard<std::mutex> lock(startupMutex);
      startupFinished = true;
    }
    startupReady.notify_one();
    if (!mouseHook) {
      auto event = std::make_unique<MouseEvent>();
      event->kind = "error";
      event->name = "Windows mouse hook could not start";
      Emit(std::move(event));
    } else {
      auto event = std::make_unique<MouseEvent>();
      event->kind = "ready";
      Emit(std::move(event));
      while (GetMessage(&message, nullptr, 0, 0) > 0) {
        TranslateMessage(&message);
        DispatchMessage(&message);
      }
      UnhookWindowsHookEx(mouseHook);
      mouseHook = nullptr;
    }
    hookThreadId = 0;
    running = false;
    callback.Release();
  });
  {
    std::unique_lock<std::mutex> lock(startupMutex);
    startupReady.wait(lock, [] { return startupFinished; });
  }
  return Napi::Boolean::New(env, true);
}

Napi::Value Stop(const Napi::CallbackInfo& info) {
  activeGesture = 0;
  swallowRightUp = false;
  if (hookThreadId) PostThreadMessage(hookThreadId, WM_QUIT, 0, 0);
  if (hookThread.joinable()) hookThread.join();
  visible = false;
  return info.Env().Undefined();
}

Napi::Value SetVisible(const Napi::CallbackInfo& info) {
  visible = info[0].ToBoolean().Value();
  return info.Env().Undefined();
}

Napi::Value SetEnabled(const Napi::CallbackInfo& info) {
  enabled = info[0].ToBoolean().Value();
  if (!enabled) {
    visible = false;
    activeGesture = 0;
  }
  return info.Env().Undefined();
}

Napi::Value SetPauseInFullscreen(const Napi::CallbackInfo& info) {
  pauseInFullscreen = info[0].ToBoolean().Value();
  return info.Env().Undefined();
}

Napi::Value SetBounds(const Napi::CallbackInfo& info) {
  LONG left = info[0].ToNumber().Int32Value();
  LONG top = info[1].ToNumber().Int32Value();
  bounds.left = left;
  bounds.top = top;
  bounds.right = left + info[2].ToNumber().Int32Value();
  bounds.bottom = top + info[3].ToNumber().Int32Value();
  return info.Env().Undefined();
}

Napi::Value Foreground(const Napi::CallbackInfo& info) {
  auto window = reinterpret_cast<LONG_PTR>(GetForegroundWindow());
  return Napi::Number::New(info.Env(), static_cast<double>(window));
}

Napi::Value OpenTerminal(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() != 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "Expected a working directory").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  const std::u16string directory = info[0].As<Napi::String>().Utf16Value();
  wchar_t windows[MAX_PATH];
  if (!GetWindowsDirectoryW(windows, MAX_PATH)) {
    Napi::Error::New(env, "Windows directory could not be found").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  const std::wstring program = std::wstring(windows) + L"\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
  wchar_t command[] = L"powershell.exe -NoExit";
  STARTUPINFOW startup{};
  startup.cb = sizeof(startup);
  PROCESS_INFORMATION process{};
  BOOL started = CreateProcessW(program.c_str(), command, nullptr, nullptr, FALSE,
                                CREATE_NEW_CONSOLE, nullptr,
                                reinterpret_cast<const wchar_t*>(directory.c_str()),
                                &startup, &process);
  if (!started) {
    const DWORD error = GetLastError();
    Napi::Error::New(env, "Terminal could not start (Windows error " + std::to_string(error) + ")")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  const DWORD pid = process.dwProcessId;
  CloseHandle(process.hThread);
  CloseHandle(process.hProcess);
  return Napi::Number::New(env, pid);
}

class CopyWorker : public Napi::AsyncProgressWorker<ULONGLONG> {
 public:
  CopyWorker(Napi::Env env, std::u16string source, std::u16string target,
             Napi::Function progressCallback)
      : Napi::AsyncProgressWorker<ULONGLONG>(env),
        deferred_(Napi::Promise::Deferred::New(env)),
        progressCallback_(Napi::Persistent(progressCallback)),
        source_(std::move(source)), target_(std::move(target)) {}

  Napi::Promise Promise() const { return deferred_.Promise(); }

  void Execute(const ExecutionProgress& progress) override {
    if (copyCancellationRequested) {
      SetError("TRANSFER_CANCELLED");
      return;
    }
    const auto* source = reinterpret_cast<const wchar_t*>(source_.c_str());
    const auto* target = reinterpret_cast<const wchar_t*>(target_.c_str());
    if (!CopyFileExW(source, target, CopyProgress,
                     const_cast<ExecutionProgress*>(&progress), nullptr,
                     COPY_FILE_FAIL_IF_EXISTS)) {
      const DWORD error = GetLastError();
      SetError(error == ERROR_REQUEST_ABORTED ? "TRANSFER_CANCELLED" :
               "Windows copy failed (error " + std::to_string(error) + ")");
    }
  }

  void OnProgress(const ULONGLONG* data, size_t count) override {
    if (count) progressCallback_.Call({Napi::Number::New(Env(), static_cast<double>(data[count - 1]))});
  }

  void OnOK() override { deferred_.Resolve(Env().Undefined()); }
  void OnError(const Napi::Error& error) override { deferred_.Reject(error.Value()); }

 private:
  static DWORD CALLBACK CopyProgress(LARGE_INTEGER, LARGE_INTEGER transferred,
                                     LARGE_INTEGER, LARGE_INTEGER, DWORD, DWORD,
                                     HANDLE, HANDLE, LPVOID data) {
    const auto* progress = static_cast<ExecutionProgress*>(data);
    if (copyCancellationRequested) return PROGRESS_CANCEL;
    const ULONGLONG bytes = static_cast<ULONGLONG>(transferred.QuadPart);
    progress->Send(&bytes, 1);
    return PROGRESS_CONTINUE;
  }

  Napi::Promise::Deferred deferred_;
  Napi::FunctionReference progressCallback_;
  std::u16string source_;
  std::u16string target_;
};

Napi::Value CopyFileWithProgress(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() != 3 || !info[0].IsString() || !info[1].IsString() || !info[2].IsFunction()) {
    Napi::TypeError::New(env, "Expected source, target and progress callback")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  auto* worker = new CopyWorker(env, info[0].As<Napi::String>().Utf16Value(),
                                info[1].As<Napi::String>().Utf16Value(),
                                info[2].As<Napi::Function>());
  copyCancellationRequested = false;
  Napi::Promise promise = worker->Promise();
  worker->Queue();
  return promise;
}

Napi::Value CancelCurrentCopy(const Napi::CallbackInfo& info) {
  copyCancellationRequested = true;
  return info.Env().Undefined();
}

Napi::Value MoveFileExclusive(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() != 2 || !info[0].IsString() || !info[1].IsString()) {
    Napi::TypeError::New(env, "Expected source and target paths").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  const std::u16string source = info[0].As<Napi::String>().Utf16Value();
  const std::u16string target = info[1].As<Napi::String>().Utf16Value();
  if (!MoveFileW(reinterpret_cast<const wchar_t*>(source.c_str()),
                 reinterpret_cast<const wchar_t*>(target.c_str()))) {
    Napi::Error::New(env, "Windows error " + std::to_string(GetLastError()))
        .ThrowAsJavaScriptException();
  }
  return env.Undefined();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("start", Napi::Function::New(env, Start));
  exports.Set("stop", Napi::Function::New(env, Stop));
  exports.Set("setVisible", Napi::Function::New(env, SetVisible));
  exports.Set("setEnabled", Napi::Function::New(env, SetEnabled));
  exports.Set("setPauseInFullscreen", Napi::Function::New(env, SetPauseInFullscreen));
  exports.Set("setBounds", Napi::Function::New(env, SetBounds));
  exports.Set("foreground", Napi::Function::New(env, Foreground));
  exports.Set("openTerminal", Napi::Function::New(env, OpenTerminal));
  exports.Set("copyFile", Napi::Function::New(env, CopyFileWithProgress));
  exports.Set("cancelCopy", Napi::Function::New(env, CancelCurrentCopy));
  exports.Set("getExplorerContext", Napi::Function::New(env, GetExplorerContext));
  exports.Set("moveFileExclusive", Napi::Function::New(env, MoveFileExclusive));
  exports.Set("showFileProperties", Napi::Function::New(env, ShowFileProperties));
  exports.Set("checkFileUsers", Napi::Function::New(env, CheckFileUsers));
  return exports;
}

}  // namespace

NODE_API_MODULE(mouse_bridge, Init)
