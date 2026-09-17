{
  "comment": "Blackmagic Desktop Video SDK embedded-audio capture. Run prepare-sdk.sh / prepare-sdk.ps1 first to vendor the CURRENT SDK headers into sdk/include. The Desktop Video DRIVER is a runtime dependency installed by the user, never bundled.",
  "targets": [
    {
      "target_name": "decklink_audio",
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "sdk/include"
      ],
      "dependencies": [ "<!(node -p \"require('node-addon-api').gyp\")" ],
      "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS" ],
      "conditions": [
        [ "OS==\"mac\"", {
          "sources": [ "decklink_audio.cc", "sdk/include/DeckLinkAPIDispatch.cpp" ],
          "link_settings": { "libraries": [ "-framework CoreFoundation" ] },
          "xcode_settings": {
            "CLANG_CXX_LIBRARY": "libc++",
            "MACOSX_DEPLOYMENT_TARGET": "13.0",
            "OTHER_CPLUSPLUSFLAGS": [
              "-std=c++17",
              "-isysroot", "<!(xcrun --show-sdk-path)",
              "-isystem", "<!(xcrun --show-sdk-path)/usr/include/c++/v1"
            ],
            "OTHER_LDFLAGS": [ "-isysroot", "<!(xcrun --show-sdk-path)" ]
          }
        } ],
        [ "OS==\"win\"", {
          "sources": [ "decklink_audio.cc", "sdk/include/DeckLinkAPI_i.c" ],
          "libraries": [ "comsuppw.lib", "ole32.lib", "oleaut32.lib" ],
          "defines": [ "NOMINMAX", "WIN32_LEAN_AND_MEAN" ],
          "msvs_settings": { "VCCLCompilerTool": { "AdditionalOptions": [ "/std:c++17" ] } }
        } ]
      ]
    }
  ]
}
