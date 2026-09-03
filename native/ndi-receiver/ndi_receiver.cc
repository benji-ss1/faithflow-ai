// PresentFlow native NDI AUDIO RECEIVER addon.
//
// !!! UNVERIFIED — written against NDI SDK v6 headers but NOT yet compiled or run.
//     Build with node-gyp/electron-rebuild on a WINDOWS machine that has the NDI 6
//     SDK + the MSVC build tools, then validate on-site against the church's OBS +
//     DistroAV NDI source. (macOS is supported too, mirroring the sender addon.) !!!
//
// A thin, in-process N-API wrapper around the OFFICIAL NDI SDK RECEIVE API,
// scoped to AUDIO ONLY (NDIlib_recv_bandwidth_audio_only). It:
//   - discovers NDI sources on the LAN (NDIlib_find_*), exactly like OBS/DistroAV,
//   - connects to a chosen source and receives its embedded audio,
//   - converts each NDI float audio frame to interleaved 16-bit PCM
//     (NDIlib_util_audio_to_interleaved_16s_v2) and hands it to JS on a
//     ThreadSafeFunction, tagged with the source sample-rate + channel count.
//
// The Electron MAIN process (electron/ndi/NDIReceiveService.ts) then down-mixes to
// mono + resamples to 16 kHz and forwards the PCM to the renderer, which feeds it
// into the SAME Deepgram/Fly pipeline as a locally-connected USB device. Receive
// only — this addon never sends. No networking logic lives in the renderer.
//
// Design points:
//  - The runtime is initialized EXACTLY ONCE per process (shared with the sender
//    addon's own init — NDIlib_initialize is idempotent-safe to call once here).
//  - Capture runs on a DEDICATED background thread (NDIlib_recv_capture_v3 blocks),
//    so it never touches the Node/UI thread; PCM crosses back via a
//    ThreadSafeFunction.
//  - Never crashes the app if NDI is unavailable — all failures surface as a
//    thrown JS error at construct/connect time, which the service catches.

#include <napi.h>
#include <string>
#include <vector>
#include <thread>
#include <atomic>
#include <cstring>
#include <cstdint>

#include <Processing.NDI.Lib.h>

namespace {

// Initialize the NDI runtime once per process. Returns availability.
static bool ensure_ndi_initialized() {
  static bool attempted = false;
  static bool ok = false;
  if (!attempted) { attempted = true; ok = NDIlib_initialize(); }
  return ok;
}

// One decoded audio chunk handed from the capture thread to JS.
struct AudioChunk {
  std::vector<int16_t> pcm; // interleaved 16-bit
  int sampleRate = 48000;
  int channels = 2;
};

class NdiReceiver : public Napi::ObjectWrap<NdiReceiver> {
public:
  static Napi::Object Init(Napi::Env env, Napi::Object exports);
  NdiReceiver(const Napi::CallbackInfo& info);
  ~NdiReceiver();

private:
  NDIlib_find_instance_t find_ = nullptr;
  NDIlib_recv_instance_t recv_ = nullptr;
  std::thread thread_;
  std::atomic<bool> running_{false};
  Napi::ThreadSafeFunction tsfn_;
  std::atomic<bool> tsfn_active_{false};

  Napi::Value ListSources(const Napi::CallbackInfo& info); // -> [{ name, urlAddress }]
  Napi::Value Connect(const Napi::CallbackInfo& info);      // (sourceName: string, onAudio: fn) -> bool
  Napi::Value Disconnect(const Napi::CallbackInfo& info);   // -> void
  Napi::Value IsConnected(const Napi::CallbackInfo& info);  // -> bool

  void CaptureLoop();
  void StopCapture();
};

Napi::Object NdiReceiver::Init(Napi::Env env, Napi::Object exports) {
  Napi::Function func = DefineClass(env, "NdiReceiver", {
    InstanceMethod("listSources", &NdiReceiver::ListSources),
    InstanceMethod("connect", &NdiReceiver::Connect),
    InstanceMethod("disconnect", &NdiReceiver::Disconnect),
    InstanceMethod("isConnected", &NdiReceiver::IsConnected),
  });
  exports.Set("NdiReceiver", func);
  return exports;
}

NdiReceiver::NdiReceiver(const Napi::CallbackInfo& info) : Napi::ObjectWrap<NdiReceiver>(info) {
  Napi::Env env = info.Env();
  if (!ensure_ndi_initialized()) {
    Napi::Error::New(env, "NDIlib_initialize() failed (CPU unsupported or SDK/runtime not found)").ThrowAsJavaScriptException();
    return;
  }
  // A persistent finder so listSources() reflects the live network. show_local_sources
  // = true so a same-machine OBS source is also discoverable (dev/testing).
  NDIlib_find_create_t fdesc;
  fdesc.show_local_sources = true;
  fdesc.p_groups = nullptr;
  fdesc.p_extra_ips = nullptr;
  find_ = NDIlib_find_create_v2(&fdesc);
  if (!find_) {
    Napi::Error::New(env, "NDIlib_find_create_v2() returned NULL").ThrowAsJavaScriptException();
  }
}

NdiReceiver::~NdiReceiver() {
  StopCapture();
  if (find_) { NDIlib_find_destroy(find_); find_ = nullptr; }
  // Never call NDIlib_destroy() here — it is a PROCESS-GLOBAL teardown shared with
  // the sender; leave the runtime for the OS to reclaim at process exit.
}

Napi::Value NdiReceiver::ListSources(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Array arr = Napi::Array::New(env);
  if (!find_) return arr;
  // Non-blocking snapshot of the currently-known sources. The service polls this
  // on a timer, so we don't wait here (timeout 0).
  uint32_t no_sources = 0;
  const NDIlib_source_t* sources = NDIlib_find_get_current_sources(find_, &no_sources);
  if (!sources) return arr;
  for (uint32_t i = 0; i < no_sources; i++) {
    Napi::Object o = Napi::Object::New(env);
    o.Set("name", Napi::String::New(env, sources[i].p_ndi_name ? sources[i].p_ndi_name : ""));
    // p_url_address is a union member with p_ip_address depending on SDK; guard it.
    o.Set("urlAddress", Napi::String::New(env, sources[i].p_url_address ? sources[i].p_url_address : ""));
    arr.Set(i, o);
  }
  return arr;
}

Napi::Value NdiReceiver::Connect(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsFunction()) {
    Napi::TypeError::New(env, "connect(sourceName: string, onAudio: (pcm, sampleRate, channels) => void)").ThrowAsJavaScriptException();
    return Napi::Boolean::New(env, false);
  }
  const std::string wanted = info[0].As<Napi::String>().Utf8Value();

  // Tear down any prior session first (idempotent re-connect).
  StopCapture();

  if (!find_) { Napi::Error::New(env, "finder not initialized").ThrowAsJavaScriptException(); return Napi::Boolean::New(env, false); }

  // Resolve the wanted source by name from the current network snapshot.
  uint32_t no_sources = 0;
  const NDIlib_source_t* sources = NDIlib_find_get_current_sources(find_, &no_sources);
  const NDIlib_source_t* match = nullptr;
  for (uint32_t i = 0; sources && i < no_sources; i++) {
    if (sources[i].p_ndi_name && wanted == sources[i].p_ndi_name) { match = &sources[i]; break; }
  }
  if (!match) {
    Napi::Error::New(env, "NDI source not found on the network: " + wanted).ThrowAsJavaScriptException();
    return Napi::Boolean::New(env, false);
  }

  // Audio-only receiver — we never pull video, so bandwidth stays tiny.
  NDIlib_recv_create_v3_t rdesc;
  rdesc.source_to_connect_to = *match;
  rdesc.color_format = NDIlib_recv_color_format_fastest;
  rdesc.bandwidth = NDIlib_recv_bandwidth_audio_only;
  rdesc.allow_video_fields = false;
  rdesc.p_ndi_recv_name = "PresentFlow Audio Receiver";
  recv_ = NDIlib_recv_create_v3(&rdesc);
  if (!recv_) {
    Napi::Error::New(env, "NDIlib_recv_create_v3() returned NULL").ThrowAsJavaScriptException();
    return Napi::Boolean::New(env, false);
  }

  // ThreadSafeFunction bridges the capture thread → the JS onAudio callback.
  tsfn_ = Napi::ThreadSafeFunction::New(
    env,
    info[1].As<Napi::Function>(),
    "NdiAudioCallback",
    0,   // unlimited queue
    1    // one thread will call it
  );
  tsfn_active_ = true;
  running_ = true;
  thread_ = std::thread(&NdiReceiver::CaptureLoop, this);
  return Napi::Boolean::New(env, true);
}

void NdiReceiver::CaptureLoop() {
  while (running_.load()) {
    NDIlib_audio_frame_v2_t audio;
    // 200ms timeout so the loop wakes to check running_ even with no audio.
    NDIlib_frame_type_e t = NDIlib_recv_capture_v3(recv_, nullptr, &audio, nullptr, 200);
    if (t != NDIlib_frame_type_audio) {
      // Nothing (timeout) or a non-audio frame — nothing to free for audio; the
      // SDK only allocates on the type it returned.
      continue;
    }
    if (audio.no_samples <= 0 || audio.no_channels <= 0 || !audio.p_data) {
      NDIlib_recv_free_audio_v2(recv_, &audio);
      continue;
    }

    // Convert the planar float NDI frame → interleaved 16-bit PCM.
    AudioChunk chunk;
    chunk.sampleRate = audio.sample_rate;
    chunk.channels = audio.no_channels;
    chunk.pcm.resize((size_t)audio.no_samples * (size_t)audio.no_channels);

    NDIlib_audio_frame_interleaved_16s_t out;
    out.sample_rate = audio.sample_rate;
    out.no_channels = audio.no_channels;
    out.no_samples = audio.no_samples;
    out.timecode = audio.timecode;
    out.reference_level = 20; // 20 dB of headroom (SDK default) — matches SMPTE/NDI
    out.p_data = chunk.pcm.data();
    NDIlib_util_audio_to_interleaved_16s_v2(&audio, &out);

    NDIlib_recv_free_audio_v2(recv_, &audio);

    if (!tsfn_active_) break;
    // Hand the chunk to JS. NonBlockingCall so a slow consumer can't wedge the
    // capture thread (audio is realtime — drop rather than stall).
    AudioChunk* payload = new AudioChunk(std::move(chunk));
    napi_status st = tsfn_.NonBlockingCall(payload, [](Napi::Env env, Napi::Function jsCallback, AudioChunk* data) {
      Napi::Buffer<int16_t> buf = Napi::Buffer<int16_t>::Copy(env, data->pcm.data(), data->pcm.size());
      jsCallback.Call({ buf, Napi::Number::New(env, data->sampleRate), Napi::Number::New(env, data->channels) });
      delete data;
    });
    if (st != napi_ok) {
      // Queue full / TSFN closing — drop this chunk.
      delete payload;
    }
  }
}

void NdiReceiver::StopCapture() {
  running_ = false;
  if (thread_.joinable()) thread_.join();
  if (tsfn_active_) { tsfn_.Release(); tsfn_active_ = false; }
  if (recv_) { NDIlib_recv_destroy(recv_); recv_ = nullptr; }
}

Napi::Value NdiReceiver::Disconnect(const Napi::CallbackInfo& info) {
  StopCapture();
  return info.Env().Undefined();
}

Napi::Value NdiReceiver::IsConnected(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), running_.load() && recv_ != nullptr);
}

} // namespace

Napi::Object InitAll(Napi::Env env, Napi::Object exports) {
  return NdiReceiver::Init(env, exports);
}
NODE_API_MODULE(ndi_receiver, InitAll)
