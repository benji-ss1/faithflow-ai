// decklink_audio.cc — Blackmagic DeckLink / UltraStudio EMBEDDED AUDIO capture
// (hardware I/O Phase C, docs/HARDWARE_IO_PLAN.md).
//
// Reads SDI/HDMI embedded audio (up to 16ch, 48 kHz, s16) through the
// Blackmagic Desktop Video SDK and hands interleaved PCM to JS. Video frames are
// ignored — we only enable video input because DeckLink delivers audio packets
// alongside video frames. Format auto-detection re-arms the input when the
// source changes (1080i59.94 → 1080p50 etc.), so the operator never has to
// match formats by hand (vMix/OBS #1 support issue).
//
// Runtime dependency: the user-installed Blackmagic Desktop Video driver. The
// SDK dispatch layer loads it lazily, so this addon LOADS FINE without the
// driver — isAvailable() just returns false (graceful degrade, NDI pattern).
//
// UNVERIFIED ON HARDWARE — compile-checked only. Build against the CURRENT
// Desktop Video SDK headers vendored by prepare-sdk.{sh,ps1}.

#include <napi.h>
#include <atomic>
#include <mutex>
#include <string>
#include <vector>
#ifndef _WIN32
#include <unistd.h>
#endif

#ifdef _WIN32
#include <windows.h>
#include <comutil.h>
#include "DeckLinkAPI_h.h"
typedef BSTR DLString;
#else
#include <CoreFoundation/CoreFoundation.h>
#include "DeckLinkAPI.h"
typedef CFStringRef DLString;
#endif
#include "DeckLinkAPIVersion.h"

// SDK 11 renamed IDeckLinkAttributes → IDeckLinkProfileAttributes.
#if BLACKMAGIC_DECKLINK_API_VERSION >= 0x0b000000
typedef IDeckLinkProfileAttributes DLAttributes;
#define IID_DLAttributes IID_IDeckLinkProfileAttributes
#else
typedef IDeckLinkAttributes DLAttributes;
#define IID_DLAttributes IID_IDeckLinkAttributes
#endif

namespace {

std::string toUtf8(DLString s) {
  if (!s) return {};
#ifdef _WIN32
  int n = WideCharToMultiByte(CP_UTF8, 0, s, -1, nullptr, 0, nullptr, nullptr);
  std::string out(n > 0 ? n - 1 : 0, '\0');
  if (n > 1) WideCharToMultiByte(CP_UTF8, 0, s, -1, &out[0], n, nullptr, nullptr);
  SysFreeString(s);
  return out;
#else
  char buf[512];
  std::string out = CFStringGetCString(s, buf, sizeof buf, kCFStringEncodingUTF8) ? buf : "";
  CFRelease(s);
  return out;
#endif
}

IDeckLinkIterator* createIterator() {
#ifdef _WIN32
  CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  IDeckLinkIterator* it = nullptr;
  if (FAILED(CoCreateInstance(CLSID_CDeckLinkIterator, nullptr, CLSCTX_ALL, IID_IDeckLinkIterator, (void**)&it))) return nullptr;
  return it;
#else
  return CreateDeckLinkIteratorInstance();
#endif
}

// Walk devices; returns the device at `index` (AddRef'd) or null.
IDeckLink* deviceAt(int index) {
  IDeckLinkIterator* it = createIterator();
  if (!it) return nullptr;
  IDeckLink* dl = nullptr;
  IDeckLink* found = nullptr;
  int i = 0;
  while (it->Next(&dl) == S_OK) {
    if (i++ == index) { found = dl; break; }
    dl->Release();
  }
  it->Release();
  return found;
}

using Tsfn = Napi::ThreadSafeFunction;

class Capture final : public IDeckLinkInputCallback {
 public:
  Capture(IDeckLinkInput* in, uint32_t ch, Tsfn tsfn) : input_(in), channels_(ch), tsfn_(tsfn) {}

  // Driver callbacks run on Blackmagic threads. `inflight_` lets stop() wait
  // until none are executing before the object/TSFN are torn down.
  struct Guard {
    Capture* c;
    bool ok;
    explicit Guard(Capture* cap) : c(cap) {
      c->inflight_.fetch_add(1);
      ok = !c->stopping_.load();
    }
    ~Guard() { c->inflight_.fetch_sub(1); }
  };

  HRESULT VideoInputFormatChanged(BMDVideoInputFormatChangedEvents, IDeckLinkDisplayMode* mode, BMDDetectedVideoInputFormatFlags flags) override {
    Guard g(this);
    if (!g.ok || !mode) return S_OK;
    // Re-arm on the detected format so audio keeps flowing after a source change.
    BMDPixelFormat pf = (flags & bmdDetectedVideoInputRGB444) ? bmdFormat8BitARGB : bmdFormat8BitYUV;
    input_->PauseStreams();
    input_->EnableVideoInput(mode->GetDisplayMode(), pf, bmdVideoInputEnableFormatDetection);
    input_->FlushStreams();
    input_->StartStreams();
    return S_OK;
  }

  HRESULT VideoInputFrameArrived(IDeckLinkVideoInputFrame*, IDeckLinkAudioInputPacket* audio) override {
    Guard g(this);
    if (!g.ok || !audio) return S_OK;
    long frames = audio->GetSampleFrameCount();
    void* bytes = nullptr;
    // A packet is ~one video frame of audio (≤ 4800 @ 10fps); cap defensively.
    if (frames <= 0 || frames > 48000 || audio->GetBytes(&bytes) != S_OK || !bytes) return S_OK;
    size_t n = static_cast<size_t>(frames) * channels_ * sizeof(int16_t);
    auto* copy = new std::vector<uint8_t>(static_cast<uint8_t*>(bytes), static_cast<uint8_t*>(bytes) + n);
    auto status = tsfn_.NonBlockingCall(copy, [](Napi::Env env, Napi::Function cb, std::vector<uint8_t>* data) {
      cb.Call({Napi::Buffer<uint8_t>::Copy(env, data->data(), data->size())});
      delete data;
    });
    if (status != napi_ok) delete copy;  // queue full / closing — drop, never block the driver thread
    return S_OK;
  }

  HRESULT QueryInterface(REFIID, LPVOID*) override { return E_NOINTERFACE; }
  ULONG AddRef() override { return ++refs_; }
  ULONG Release() override { return --refs_; }  // lifetime owned by Session

  std::atomic<bool> stopping_{false};
  std::atomic<int> inflight_{0};

 private:
  IDeckLinkInput* input_;
  uint32_t channels_;
  Tsfn tsfn_;
  std::atomic<ULONG> refs_{1};
};

struct Session {
  IDeckLink* device = nullptr;
  IDeckLinkInput* input = nullptr;
  Capture* cb = nullptr;
  Tsfn tsfn;
};

std::mutex g_mu;
Session* g_session = nullptr;

void stopLocked() {
  if (!g_session) return;
  Session* s = g_session;
  g_session = nullptr;
  if (s->cb) s->cb->stopping_ = true;
  // Wait for any in-flight driver callback to leave BEFORE touching the
  // input: a format-change re-arm racing StopStreams could otherwise restart
  // streams or use a released interface. New callbacks see stopping_ and bail.
  for (int i = 0; s->cb && s->cb->inflight_.load() > 0 && i < 2000; i++) {
#ifdef _WIN32
    Sleep(1);
#else
    usleep(1000);
#endif
  }
  if (s->cb && s->cb->inflight_.load() > 0) {
    // A driver callback is stuck (>2s). Touching the input/TSFN now could be a
    // use-after-free — leak this session instead (rare, bounded, safe).
    return;
  }
  if (s->input) {
    s->input->StopStreams();
    s->input->SetCallback(nullptr);
    s->input->DisableAudioInput();
    s->input->DisableVideoInput();
    s->input->Release();
  }
  if (s->device) s->device->Release();
  s->tsfn.Abort();
  // Only free the callback if every driver thread has left it; otherwise leak
  // one small object rather than risk a use-after-free in the operator app.
  if (s->cb && s->cb->inflight_.load() == 0) delete s->cb;
  delete s;
}

Napi::Value IsAvailable(const Napi::CallbackInfo& info) {
  IDeckLinkIterator* it = createIterator();
  if (it) it->Release();
  return Napi::Boolean::New(info.Env(), it != nullptr);
}

Napi::Value ListDevices(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Array arr = Napi::Array::New(env);
  IDeckLinkIterator* it = createIterator();
  if (!it) return arr;
  IDeckLink* dl = nullptr;
  uint32_t i = 0, out = 0;
  while (it->Next(&dl) == S_OK) {
    IDeckLinkInput* in = nullptr;
    if (dl->QueryInterface(IID_IDeckLinkInput, (void**)&in) == S_OK && in) {
      int64_t maxCh = 2;
      DLAttributes* attrs = nullptr;
      if (dl->QueryInterface(IID_DLAttributes, (void**)&attrs) == S_OK && attrs) {
        attrs->GetInt(BMDDeckLinkMaximumAudioChannels, &maxCh);
        attrs->Release();
      }
      DLString name = nullptr;
      dl->GetDisplayName(&name);
      Napi::Object o = Napi::Object::New(env);
      o.Set("index", Napi::Number::New(env, i));
      o.Set("name", Napi::String::New(env, toUtf8(name)));
      o.Set("channelCount", Napi::Number::New(env, static_cast<double>(maxCh)));
      o.Set("sampleRate", Napi::Number::New(env, 48000));
      arr.Set(out++, o);
      in->Release();
    }
    dl->Release();
    i++;
  }
  it->Release();
  return arr;
}

// start(index: number, channels: 2|8|16, onPcm: (buf: Buffer) => void) → { ok, error? }
Napi::Value Start(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Object res = Napi::Object::New(env);
  auto fail = [&](const char* msg) { res.Set("ok", false); res.Set("error", msg); return res; };
  if (info.Length() < 3 || !info[0].IsNumber() || !info[1].IsNumber() || !info[2].IsFunction()) return fail("invalid arguments");
  uint32_t ch = info[1].As<Napi::Number>().Uint32Value();
  if (ch != 2 && ch != 8 && ch != 16) return fail("channels must be 2, 8 or 16");

  std::lock_guard<std::mutex> lock(g_mu);
  stopLocked();
  IDeckLink* dl = deviceAt(info[0].As<Napi::Number>().Int32Value());
  if (!dl) return fail("Blackmagic device not found — is Desktop Video installed and the device connected?");
  IDeckLinkInput* in = nullptr;
  if (dl->QueryInterface(IID_IDeckLinkInput, (void**)&in) != S_OK || !in) { dl->Release(); return fail("device has no input"); }

  auto* s = new Session();
  s->device = dl;
  s->input = in;
  s->tsfn = Tsfn::New(env, info[2].As<Napi::Function>(), "decklink-audio", 64, 1);
  s->cb = new Capture(in, ch, s->tsfn);
  g_session = s;

  // Start on a common mode with format detection; the callback re-arms to the real signal.
  if (in->SetCallback(s->cb) != S_OK ||
      in->EnableVideoInput(bmdModeHD1080i5994, bmdFormat8BitYUV, bmdVideoInputEnableFormatDetection) != S_OK) {
    stopLocked();
    return fail("Could not open the Blackmagic input — it may be in use by another app (Media Express, OBS, vMix, ProPresenter).");
  }
  if (in->EnableAudioInput(bmdAudioSampleRate48kHz, bmdAudioSampleType16bitInteger, ch) != S_OK) {
    stopLocked();
    return fail("This Blackmagic device does not support that many audio channels.");
  }
  if (in->StartStreams() != S_OK) {
    stopLocked();
    return fail("Blackmagic input failed to start.");
  }
  res.Set("ok", true);
  return res;
}

Napi::Value Stop(const Napi::CallbackInfo& info) {
  std::lock_guard<std::mutex> lock(g_mu);
  stopLocked();
  return info.Env().Undefined();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("isAvailable", Napi::Function::New(env, IsAvailable));
  exports.Set("listDevices", Napi::Function::New(env, ListDevices));
  exports.Set("start", Napi::Function::New(env, Start));
  exports.Set("stop", Napi::Function::New(env, Stop));
  return exports;
}

}  // namespace

NODE_API_MODULE(decklink_audio, Init)
