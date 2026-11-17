#include "explorer_context.h"

#include <windows.h>
#include <exdisp.h>
#include <shldisp.h>
#include <shlobj.h>
#include <shlguid.h>
#include <servprov.h>

#include <string>
#include <vector>

namespace {

template <typename T>
class ComPtr {
 public:
  ~ComPtr() { if (value_) value_->Release(); }
  T* operator->() const { return value_; }
  T* Get() const { return value_; }
  T** Out() { return &value_; }
  explicit operator bool() const { return value_ != nullptr; }

 private:
  T* value_ = nullptr;
};

std::wstring ItemPath(FolderItem* item) {
  BSTR value = nullptr;
  if (!item || FAILED(item->get_Path(&value)) || !value) return {};
  std::wstring path(value, SysStringLen(value));
  SysFreeString(value);
  return path;
}

std::wstring ViewFolder(IShellFolderViewDual* view) {
  ComPtr<Folder> folder;
  if (FAILED(view->get_Folder(folder.Out())) || !folder) return {};
  ComPtr<Folder2> folder2;
  if (FAILED(folder->QueryInterface(IID_Folder2,
                                    reinterpret_cast<void**>(folder2.Out()))) || !folder2) return {};
  ComPtr<FolderItem> self;
  if (FAILED(folder2->get_Self(self.Out())) || !self) return {};
  return ItemPath(self.Get());
}

std::vector<std::wstring> ViewSelection(IShellFolderViewDual* view) {
  std::vector<std::wstring> result;
  ComPtr<FolderItems> items;
  if (FAILED(view->SelectedItems(items.Out())) || !items) return {std::wstring()};
  long count = 0;
  if (FAILED(items->get_Count(&count))) return {std::wstring()};
  for (long index = 0; index < count; ++index) {
    VARIANT key;
    VariantInit(&key);
    key.vt = VT_I4;
    key.lVal = index;
    ComPtr<FolderItem> item;
    // Keep pathless items so JavaScript can reject an incomplete selection.
    if (SUCCEEDED(items->Item(key, item.Out())) && item)
      result.push_back(ItemPath(item.Get()));
    else
      result.emplace_back();
  }
  return result;
}

bool IsDesktopWindow(LONG_PTR window) {
  HWND handle = reinterpret_cast<HWND>(window);
  if (!handle) return false;
  if (handle == GetShellWindow()) return true;
  wchar_t className[64]{};
  if (!GetClassNameW(handle, className, 64)) return false;
  return wcscmp(className, L"Progman") == 0 || wcscmp(className, L"WorkerW") == 0;
}

std::wstring KnownFolder(REFKNOWNFOLDERID id) {
  PWSTR raw = nullptr;
  if (FAILED(SHGetKnownFolderPath(id, 0, nullptr, &raw)) || !raw) return {};
  std::wstring result(raw);
  CoTaskMemFree(raw);
  return result;
}

std::vector<std::wstring> DesktopSelection(IShellWindows* windows) {
  VARIANT location;
  VariantInit(&location);
  location.vt = VT_I4;
  location.lVal = CSIDL_DESKTOP;
  VARIANT root;
  VariantInit(&root);
  long handle = 0;
  ComPtr<IDispatch> dispatch;
  if (FAILED(windows->FindWindowSW(&location, &root, SWC_DESKTOP, &handle,
                                   SWFO_NEEDDISPATCH, dispatch.Out())) || !dispatch)
    return {std::wstring()};
  ComPtr<IServiceProvider> provider;
  if (FAILED(dispatch->QueryInterface(IID_IServiceProvider,
                                      reinterpret_cast<void**>(provider.Out()))) || !provider)
    return {std::wstring()};
  ComPtr<IShellBrowser> browser;
  if (FAILED(provider->QueryService(SID_STopLevelBrowser, IID_IShellBrowser,
                                    reinterpret_cast<void**>(browser.Out()))) || !browser)
    return {std::wstring()};
  ComPtr<IShellView> shellView;
  if (FAILED(browser->QueryActiveShellView(shellView.Out())) || !shellView)
    return {std::wstring()};
  ComPtr<IDispatch> viewDispatch;
  if (FAILED(shellView->GetItemObject(SVGIO_BACKGROUND, IID_IDispatch,
                                      reinterpret_cast<void**>(viewDispatch.Out()))) || !viewDispatch)
    return {std::wstring()};
  ComPtr<IShellFolderViewDual> view;
  if (FAILED(viewDispatch->QueryInterface(IID_IShellFolderViewDual,
                                    reinterpret_cast<void**>(view.Out()))) || !view)
    return {std::wstring()};
  return ViewSelection(view.Get());
}

Napi::String JsPath(Napi::Env env, const std::wstring& path) {
  return Napi::String::New(env, std::u16string(
      reinterpret_cast<const char16_t*>(path.data()), path.size()));
}

class ExplorerWorker : public Napi::AsyncWorker {
 public:
  ExplorerWorker(Napi::Env env, LONG_PTR window)
      : Napi::AsyncWorker(env), deferred_(Napi::Promise::Deferred::New(env)), window_(window) {}

  Napi::Promise Promise() const { return deferred_.Promise(); }

  void Execute() override {
    const HRESULT initialized = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    if (FAILED(initialized)) {
      SetError("Windows Shell COM could not initialize");
      return;
    }
    {
      ComPtr<IShellWindows> windows;
      const HRESULT created = CoCreateInstance(CLSID_ShellWindows, nullptr, CLSCTX_ALL,
                                               IID_IShellWindows,
                                               reinterpret_cast<void**>(windows.Out()));
      if (FAILED(created) || !windows) {
        SetError("Windows Shell windows could not be queried");
      } else {
        if (IsDesktopWindow(window_)) {
          folder_ = KnownFolder(FOLDERID_Desktop);
          publicDesktop_ = KnownFolder(FOLDERID_PublicDesktop);
          selected_ = DesktopSelection(windows.Get());
          desktop_ = true;
        }
        long count = 0;
        if (FAILED(windows->get_Count(&count))) {
          SetError("Windows Shell window count could not be read");
        } else {
          for (long index = 0; index < count; ++index) {
            VARIANT key;
            VariantInit(&key);
            key.vt = VT_I4;
            key.lVal = index;
            ComPtr<IDispatch> dispatch;
            if (FAILED(windows->Item(key, dispatch.Out())) || !dispatch) continue;
            ComPtr<IWebBrowser2> browser;
            if (FAILED(dispatch->QueryInterface(IID_IWebBrowser2,
                                                reinterpret_cast<void**>(browser.Out()))) || !browser) continue;
            SHANDLE_PTR handle = 0;
            if (FAILED(browser->get_HWND(&handle))) continue;
            ComPtr<IDispatch> document;
            if (FAILED(browser->get_Document(document.Out())) || !document) continue;
            ComPtr<IShellFolderViewDual> view;
            if (FAILED(document->QueryInterface(IID_IShellFolderViewDual,
                                                reinterpret_cast<void**>(view.Out()))) || !view) continue;
            std::wstring folder = ViewFolder(view.Get());
            if (folder.empty()) continue;
            openFolders_.push_back(folder);
            if (static_cast<LONG_PTR>(handle) == window_) {
              folder_ = std::move(folder);
              selected_ = ViewSelection(view.Get());
            }
          }
        }
      }
    }
    CoUninitialize();
  }

  void OnOK() override {
    Napi::Env env = Env();
    Napi::Object result = Napi::Object::New(env);
    result.Set("folder", JsPath(env, folder_));
    result.Set("desktop", desktop_);
    result.Set("publicDesktop", JsPath(env, publicDesktop_));
    Napi::Array selected = Napi::Array::New(env, selected_.size());
    for (size_t index = 0; index < selected_.size(); ++index)
      selected.Set(index, JsPath(env, selected_[index]));
    result.Set("selected", selected);
    Napi::Array openFolders = Napi::Array::New(env, openFolders_.size());
    for (size_t index = 0; index < openFolders_.size(); ++index)
      openFolders.Set(index, JsPath(env, openFolders_[index]));
    result.Set("openFolders", openFolders);
    deferred_.Resolve(result);
  }

  void OnError(const Napi::Error& error) override { deferred_.Reject(error.Value()); }

 private:
  Napi::Promise::Deferred deferred_;
  LONG_PTR window_;
  std::wstring folder_;
  std::wstring publicDesktop_;
  bool desktop_ = false;
  std::vector<std::wstring> selected_;
  std::vector<std::wstring> openFolders_;
};

}  // namespace

Napi::Value GetExplorerContext(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() != 1 || !info[0].IsNumber()) {
    Napi::TypeError::New(env, "Expected a window handle").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  auto* worker = new ExplorerWorker(env, static_cast<LONG_PTR>(info[0].As<Napi::Number>().Int64Value()));
  Napi::Promise promise = worker->Promise();
  worker->Queue();
  return promise;
}
