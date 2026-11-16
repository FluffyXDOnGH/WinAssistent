{
  "targets": [
    {
      "target_name": "mouse_bridge",
      "sources": ["native/mouse_bridge.cc", "native/explorer_context.cc", "native/shell_actions.cc"],
      "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "libraries": ["user32.lib", "ole32.lib", "oleaut32.lib", "uiautomationcore.lib", "uuid.lib", "shell32.lib", "rstrtmgr.lib"]
    }
  ]
}
