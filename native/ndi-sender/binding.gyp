{
  "comment": "UNVERIFIED build config — tune install-name/rpath/signing on the build machine. NDI SDK v6.3.2.0 at /Library/NDI SDK for Apple.",
  "targets": [
    {
      "target_name": "ndi_sender",
      "sources": [ "ndi_sender.cc" ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "/Library/NDI SDK for Apple/include"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS" ],
      "conditions": [
        [ "OS==\"mac\"", {
          "libraries": [
            "/Library/NDI SDK for Apple/lib/macOS/libndi.dylib"
          ],
          "xcode_settings": {
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "CLANG_CXX_LIBRARY": "libc++",
            "MACOSX_DEPLOYMENT_TARGET": "11.0",
            "OTHER_CPLUSPLUSFLAGS": [ "-std=c++17" ],
            "OTHER_LDFLAGS": [
              "-Wl,-rpath,@loader_path",
              "-Wl,-rpath,@loader_path/../../resources/native/macos",
              "-Wl,-rpath,/Library/NDI SDK for Apple/lib/macOS"
            ]
          }
        } ]
      ]
    }
  ]
}
