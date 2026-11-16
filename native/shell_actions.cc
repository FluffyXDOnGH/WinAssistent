#include "shell_actions.h"

#include <windows.h>
#include <shlobj.h>
#include <restartmanager.h>

#include <string>
#include <vector>

namespace {

class PropertiesWorker : public Napi::AsyncWorker {
 public:
  PropertiesWorker(Napi::Env env, std::u16string file)
      : Napi::AsyncWorker(env), deferred_(Napi::Promise::Deferred::New(env)), file_(std::move(file)) {}

  Napi::Promise Promise() const { return deferred_.Promise(); }

  void Execute() override {
    const HRESULT initialized = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    if (FAILED(initialized)) {
      SetError("Windows Shell could not initialize");
      return;
    }
    const BOOL opened = SHObjectProperties(nullptr, SHOP_FILEPATH,
                                           reinterpret_cast<const wchar_t*>(file_.c_str()), nullptr);
    if (!opened) SetError("Dateieigenschaften konnten nicht geöffnet werden (Windows-Fehler " +
                          std::to_string(GetLastError()) + ")");
    CoUninitialize();
  }

  void OnOK() override { deferred_.Resolve(Env().Undefined()); }
  void OnError(const Napi::Error& error) override { deferred_.Reject(error.Value()); }

 private:
  Napi::Promise::Deferred deferred_;
  std::u16string file_;
};

class FileUsersWorker : public Napi::AsyncWorker {
 public:
  FileUsersWorker(Napi::Env env, std::u16string file)
      : Napi::AsyncWorker(env), deferred_(Napi::Promise::Deferred::New(env)), file_(std::move(file)) {}

  Napi::Promise Promise() const { return deferred_.Promise(); }

  void Execute() override {
    DWORD session = 0;
    WCHAR key[CCH_RM_SESSION_KEY + 1]{};
    DWORD result = RmStartSession(&session, 0, key);
    if (result != ERROR_SUCCESS) {
      SetError("Dateinutzung konnte nicht geprüft werden (Windows-Fehler " + std::to_string(result) + ")");
      return;
    }
    LPCWSTR file = reinterpret_cast<const wchar_t*>(file_.c_str());
    result = RmRegisterResources(session, 1, &file, 0, nullptr, 0, nullptr);
    if (result == ERROR_SUCCESS) {
      for (int attempt = 0; attempt < 3; ++attempt) {
        UINT needed = 0;
        UINT count = 0;
        DWORD rebootReasons = 0;
        result = RmGetList(session, &needed, &count, nullptr, &rebootReasons);
        if (result == ERROR_SUCCESS) break;
        if (result != ERROR_MORE_DATA || needed > 512) break;
        std::vector<RM_PROCESS_INFO> processes(needed);
        count = needed;
        result = RmGetList(session, &needed, &count, processes.data(), &rebootReasons);
        if (result == ERROR_SUCCESS) {
          processes.resize(count);
          processes_ = std::move(processes);
          break;
        }
        if (result != ERROR_MORE_DATA) break;
      }
    }
    RmEndSession(session);
    if (result != ERROR_SUCCESS) {
      SetError("Dateinutzung konnte nicht geprüft werden (Windows-Fehler " + std::to_string(result) + ")");
    }
  }

  void OnOK() override {
    Napi::Env env = Env();
    Napi::Array result = Napi::Array::New(env, processes_.size());
    for (size_t index = 0; index < processes_.size(); ++index) {
      const auto& process = processes_[index];
      Napi::Object item = Napi::Object::New(env);
      item.Set("name", Napi::String::New(env, std::u16string(
          reinterpret_cast<const char16_t*>(process.strAppName))));
      item.Set("pid", Napi::Number::New(env, process.Process.dwProcessId));
      item.Set("service", Napi::Boolean::New(env, process.ApplicationType == RmService));
      result.Set(index, item);
    }
    deferred_.Resolve(result);
  }

  void OnError(const Napi::Error& error) override { deferred_.Reject(error.Value()); }

 private:
  Napi::Promise::Deferred deferred_;
  std::u16string file_;
  std::vector<RM_PROCESS_INFO> processes_;
};

}  // namespace

Napi::Value ShowFileProperties(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() != 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "Expected a file path").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  auto* worker = new PropertiesWorker(env, info[0].As<Napi::String>().Utf16Value());
  Napi::Promise promise = worker->Promise();
  worker->Queue();
  return promise;
}

Napi::Value CheckFileUsers(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() != 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "Expected a file path").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  auto* worker = new FileUsersWorker(env, info[0].As<Napi::String>().Utf16Value());
  Napi::Promise promise = worker->Promise();
  worker->Queue();
  return promise;
}
