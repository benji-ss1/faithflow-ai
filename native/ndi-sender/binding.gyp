{
  "comment": "UNVERIFIED build config — tune install-name/rpath/signing on the build machine. NDI SDK v6.3.2.0 at /Library/NDI SDK for Apple.",
  "targets": [
    {
      "target_name": "ndi_sender",
      "sources": [ "ndi_sender.cc" ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "ndi-sdk/include"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS" ],
      "conditions": [
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
