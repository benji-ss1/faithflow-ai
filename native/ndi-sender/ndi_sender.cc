// PresentFlow native NDI sender addon (Phase 4).
//
// !!! UNVERIFIED — written against NDI SDK v6.3.2.0 headers but NOT yet compiled
//     or run. Must be built with node-gyp/electron-rebuild on a machine with the
//     NDI SDK + Xcode, and validated end-to-end against OBS+DistroAV on-site. !!!
//
// A thin, in-process N-API wrapper around the OFFICIAL NDI SDK send API. The
// Electron MAIN process feeds it BGRA frames from the offscreen live-output
// renderer (see electron/ndi/NDIService.ts); this addon un-premultiplies alpha
// and pushes a genuine NDI video source onto the LAN. NO networking logic lives
// in the renderer/lyric components (spec §24).
//
// Design points from the spec:
//  - Genuine NDI source via NDIlib_send_create (§1, §2, §11 discovery is automatic).
//  - BGRA + straight (un-premultiplied) alpha (§6) — Electron's getBitmap() is
//    PREMULTIPLIED; we un-premultiply here with a reciprocal LUT.
//  - Keep broadcasting with 0 receivers (§19) — we never stop on disconnect.
//  - Video only (§13) — no audio submitted.
//  - Does not block the UI thread (§9) — NDIlib_send_send_video_v2 is called from
//    the main process's paint handler; for 60fps use send_video_async_v2 with a
//    double buffer (see NDIService throttling).

#include <napi.h>
#include <string>
#include <vector>
#include <cstring>
#include <cstdint>

// Official NDI SDK headers (installed at /Library/NDI SDK for Apple/include —
// binding.gyp adds that include dir). We link libndi directly (flat API); the
// shipped app bundles libndi.dylib in Resources/native/macos and finds it via an
// @rpath set in binding.gyp.
#include <Processing.NDI.Lib.h>

namespace {

// Reciprocal LUT for un-premultiply: straight = min(255, premult * 255 / a).
static uint8_t g_recip_initialized = 0;
static uint16_t g_recip[256]; // (255<<8)/a as a fixed-point-ish helper is overkill; store 255*256/a
static void init_recip() {
  if (g_recip_initialized) return;
  g_recip[0] = 0;
  for (int a = 1; a < 256; a++) g_recip[a] = (uint16_t)((255 * 256) / a); // multiply then >>8
  g_recip_initialized = 1;
}

// Initialize the NDI runtime EXACTLY ONCE per process. Multiple senders (created
// on every resolution/fps change) share it; never per-instance destroy (see the
// destructor). Returns whether NDI is available.
static bool ensure_ndi_initialized() {
  static bool attempted = false;
  static bool ok = false;
  if (!attempted) { attempted = true; ok = NDIlib_initialize(); }
  return ok;
}

class NdiSender : public Napi::ObjectWrap<NdiSender> {
public:
  static Napi::Object Init(Napi::Env env, Napi::Object exports);
  NdiSender(const Napi::CallbackInfo& info);
  ~NdiSender();

private:
  NDIlib_send_instance_t send_ = nullptr;
  std::string name_;
  int frame_rate_n_ = 60000, frame_rate_d_ = 1001; // 59.94 default; JS sets exact
  // Un-premultiplied output buffer (reused; sized to frame).
  std::vector<uint8_t> out_;
  // Double buffer for async send (the SDK reads asynchronously; we must not
  // overwrite the buffer it is still reading, so ping-pong).
  std::vector<uint8_t> outB_;
  bool useB_ = false;

  Napi::Value SendFrame(const Napi::CallbackInfo& info); // (bgraBuffer, w, h, premultiplied)
  Napi::Value GetConnections(const Napi::CallbackInfo& info); // -> number of receivers
  Napi::Value Destroy(const Napi::CallbackInfo& info);
};

Napi::Object NdiSender::Init(Napi::Env env, Napi::Object exports) {
  Napi::Function func = DefineClass(env, "NdiSender", {
    InstanceMethod("sendFrame", &NdiSender::SendFrame),
    InstanceMethod("getConnections", &NdiSender::GetConnections),
    InstanceMethod("destroy", &NdiSender::Destroy),
  });
  exports.Set("NdiSender", func);
  return exports;
}

NdiSender::NdiSender(const Napi::CallbackInfo& info) : Napi::ObjectWrap<NdiSender>(info) {
  Napi::Env env = info.Env();
  init_recip();
  // Args: (sourceName: string, frameRateN?: number, frameRateD?: number)
  name_ = info.Length() > 0 && info[0].IsString() ? info[0].As<Napi::String>().Utf8Value() : "PresentFlow - NDI 1";
  if (info.Length() > 1 && info[1].IsNumber()) frame_rate_n_ = info[1].As<Napi::Number>().Int32Value();
  if (info.Length() > 2 && info[2].IsNumber()) frame_rate_d_ = info[2].As<Napi::Number>().Int32Value();

  if (!ensure_ndi_initialized()) {
    Napi::Error::New(env, "NDIlib_initialize() failed (CPU unsupported or SDK not found)").ThrowAsJavaScriptException();
    return;
  }
  NDIlib_send_create_t desc;
  desc.p_ndi_name = name_.c_str();
  desc.p_groups = nullptr;
  desc.clock_video = true;   // rate-limit sends to our declared frame rate (§9/§14)
  desc.clock_audio = false;  // video only (§13)
  send_ = NDIlib_send_create(&desc);
  if (!send_) {
    Napi::Error::New(env, "NDIlib_send_create() returned NULL").ThrowAsJavaScriptException();
  }
}

NdiSender::~NdiSender() {
  // Only tear down THIS sender. NDIlib_destroy() is a PROCESS-GLOBAL teardown and
  // must NOT run per-instance (it would kill the NDI runtime under any other live
  // sender when this object is GC'd — e.g. after a resolution/fps change that
  // creates a new sender before the old one is collected). The runtime is init'd
  // once (ensure_ndi_initialized) and left for the OS to reclaim at process exit.
  if (send_) { NDIlib_send_destroy(send_); send_ = nullptr; }
}

Napi::Value NdiSender::SendFrame(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!send_) return env.Undefined();
  // (bgra: Buffer, w: number, h: number, premultiplied: boolean)
  if (info.Length() < 3 || !info[0].IsBuffer() || !info[1].IsNumber() || !info[2].IsNumber()) {
    Napi::TypeError::New(env, "sendFrame(bgraBuffer, width, height, premultiplied)").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  Napi::Buffer<uint8_t> buf = info[0].As<Napi::Buffer<uint8_t>>();
  const int w = info[1].As<Napi::Number>().Int32Value();
  const int h = info[2].As<Napi::Number>().Int32Value();
  const bool premultiplied = info.Length() > 3 ? info[3].As<Napi::Boolean>().Value() : true;
  const size_t need = (size_t)w * h * 4;
  if (buf.Length() < need || w <= 0 || h <= 0) return env.Undefined();

  const uint8_t* src = buf.Data();
  std::vector<uint8_t>& out = useB_ ? outB_ : out_;
  useB_ = !useB_; // ping-pong so async send never reads a buffer we're rewriting
  if (out.size() != need) out.resize(need);
  uint8_t* dst = out.data();

  if (premultiplied) {
    // Un-premultiply BGRA (Electron getBitmap is premultiplied; NDI/OBS want
    // straight alpha, else the drop-shadow/edges darken to black halos, §6).
    for (size_t i = 0; i < need; i += 4) {
      const uint8_t a = src[i + 3];
      if (a == 0) { dst[i] = 0; dst[i+1] = 0; dst[i+2] = 0; dst[i+3] = 0; continue; }
      const uint16_t r = g_recip[a]; // = 255*256/a
      // straight = min(255, (premult * r) >> 8)
      uint32_t b = ((uint32_t)src[i]   * r) >> 8; if (b > 255) b = 255;
      uint32_t g = ((uint32_t)src[i+1] * r) >> 8; if (g > 255) g = 255;
      uint32_t rr= ((uint32_t)src[i+2] * r) >> 8; if (rr> 255) rr= 255;
      dst[i] = (uint8_t)b; dst[i+1] = (uint8_t)g; dst[i+2] = (uint8_t)rr; dst[i+3] = a;
    }
  } else {
    std::memcpy(dst, src, need);
  }

  NDIlib_video_frame_v2_t frame;
  frame.xres = w;
  frame.yres = h;
  frame.FourCC = NDIlib_FourCC_type_BGRA;                  // 32-bit straight-alpha (§6)
  frame.frame_rate_N = frame_rate_n_;
  frame.frame_rate_D = frame_rate_d_;
  frame.picture_aspect_ratio = (float)w / (float)h;         // 16:9 for 1920x1080
  frame.frame_format_type = NDIlib_frame_format_type_progressive;
  frame.timecode = NDIlib_send_timecode_synthesize;         // let the SDK stamp (§14)
  frame.p_data = dst;
  frame.line_stride_in_bytes = w * 4;
  frame.p_metadata = nullptr;
  frame.timestamp = 0;

  // async so the send never blocks the paint handler / UI thread (§9). Because
  // we ping-pong `out`, the buffer this call handed the SDK stays valid until the
  // NEXT sendFrame swaps back to it — one frame of headroom, which the SDK needs.
  NDIlib_send_send_video_async_v2(send_, &frame);
  return env.Undefined();
}

Napi::Value NdiSender::GetConnections(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!send_) return Napi::Number::New(env, 0);
  // timeout 0 = non-blocking snapshot of current receiver count (§19).
  int n = NDIlib_send_get_no_connections(send_, 0);
  return Napi::Number::New(env, n);
}

Napi::Value NdiSender::Destroy(const Napi::CallbackInfo& info) {
  if (send_) {
    // Flush the async sender (pass NULL) before destroy so the SDK isn't reading
    // a freed buffer, then tear down.
    NDIlib_send_send_video_async_v2(send_, nullptr);
    NDIlib_send_destroy(send_);
    send_ = nullptr;
  }
  return info.Env().Undefined();
}

} // namespace

Napi::Object InitAll(Napi::Env env, Napi::Object exports) {
  return NdiSender::Init(env, exports);
}
NODE_API_MODULE(ndi_sender, InitAll)
