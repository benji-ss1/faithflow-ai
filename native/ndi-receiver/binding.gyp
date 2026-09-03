{
  "comment": "UNVERIFIED build config — the WINDOWS path is the primary target (Christ Embassy). Vendor the NDI SDK into ndi-sdk/ with prepare-sdk first. Windows: NDI 6 SDK at C:\\Program Files\\NDI\\NDI 6 SDK (Include + Lib\\x64\\Processing.NDI.Lib.x64.lib). macOS: /Library/NDI SDK for Apple.",
  "targets": [
    {
      "target_name": "ndi_receiver",
      "sources": [ "ndi_receiver.cc" ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "ndi-sdk/include"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS" ],
      "conditions": [
        [ "OS==\"win\"", {
          "libraries": [
            "<(module_root_dir)/ndi-sdk/lib/Processing.NDI.Lib.x64.lib"
          ],
          "defines": [ "NOMINMAX", "WIN32_LEAN_AND_MEAN" ],
          "msvs_settings": {
            "VCCLCompilerTool": {
              "ExceptionHandling": 1,
              "AdditionalOptions": [ "/std:c++17", "/EHsc" ]
            }
          }
        } ],
        [ "OS==\"mac\"", {
          "libraries": [
            "<(module_root_dir)/ndi-sdk/lib/libndi.dylib"
          ],
          "xcode_settings": {
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "CLANG_CXX_LIBRARY": "libc++",
            "MACOSX_DEPLOYMENT_TARGET": "13.0",
            "OTHER_CPLUSPLUSFLAGS": [
              "-std=c++17",
              "-isysroot", "<!(xcrun --show-sdk-path)",
              "-isystem", "<!(xcrun --show-sdk-path)/usr/include/c++/v1"
            ],
            "OTHER_LDFLAGS": [
              "-isysroot", "<!(xcrun --show-sdk-path)",
              "-Wl,-rpath,@loader_path",
              "-Wl,-rpath,<(module_root_dir)/ndi-sdk/lib",
              "-Wl,-rpath,@loader_path/../../../macos",
              "-Wl,-rpath,@loader_path/../../../../resources/native/macos"
            ]
          }
        } ]
      ]
    }
  ]
}
