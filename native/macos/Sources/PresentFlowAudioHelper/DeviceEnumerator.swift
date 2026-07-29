// DeviceEnumerator.swift — CoreAudio HAL device enumeration.
//
// Why HAL and not AVCaptureDevice/AVAudioSession: only the HAL exposes the
// stable device UID (kAudioDevicePropertyDeviceUID — persists across
// replug/reboot, which is the entire point of this helper), transport type,
// full input channel layout, and hardware hot-plug listeners.

import CoreAudio
import Foundation

struct AudioDeviceInfo {
    let id: AudioDeviceID
    let uid: String
    let name: String
    let manufacturer: String
    let transport: String
    let inputChannels: Int
    let sampleRate: Double
    let isDefaultInput: Bool

    func toJSONObject(index: Int) -> [String: Any] {
        return [
            "index": index,
            "uid": uid,
            "name": name,
            "manufacturer": manufacturer,
            "transport": transport,
            "input_channels": inputChannels,
            "sample_rate": sampleRate,
            "is_default": isDefaultInput,
        ]
    }
}

enum DeviceEnumerator {

    // MARK: property plumbing

    private static func systemObject() -> AudioObjectID {
        return AudioObjectID(kAudioObjectSystemObject)
    }

    private static func globalAddress(_ selector: AudioObjectPropertySelector,
                                      scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal)
        -> AudioObjectPropertyAddress
    {
        return AudioObjectPropertyAddress(
            mSelector: selector,
            mScope: scope,
            mElement: kAudioObjectPropertyElementMain
        )
    }

    private static func stringProperty(_ id: AudioObjectID,
                                       _ selector: AudioObjectPropertySelector) -> String? {
        var address = globalAddress(selector)
        var size = UInt32(MemoryLayout<CFString?>.size)
        var value: CFString? = nil
        let status = withUnsafeMutablePointer(to: &value) { ptr in
            AudioObjectGetPropertyData(id, &address, 0, nil, &size, ptr)
        }
        guard status == noErr, let cf = value else { return nil }
        return cf as String
    }

    private static func uint32Property(_ id: AudioObjectID,
                                       _ selector: AudioObjectPropertySelector) -> UInt32? {
        var address = globalAddress(selector)
        var size = UInt32(MemoryLayout<UInt32>.size)
        var value: UInt32 = 0
        guard AudioObjectGetPropertyData(id, &address, 0, nil, &size, &value) == noErr else {
            return nil
        }
        return value
    }

    private static func float64Property(_ id: AudioObjectID,
                                        _ selector: AudioObjectPropertySelector) -> Double? {
        var address = globalAddress(selector)
        var size = UInt32(MemoryLayout<Float64>.size)
        var value: Float64 = 0
        guard AudioObjectGetPropertyData(id, &address, 0, nil, &size, &value) == noErr else {
            return nil
        }
        return value
    }

    // MARK: enumeration

    static func allDeviceIDs() -> [AudioDeviceID] {
        var address = globalAddress(kAudioHardwarePropertyDevices)
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(systemObject(), &address, 0, nil, &size) == noErr,
              size > 0
        else { return [] }
        let count = Int(size) / MemoryLayout<AudioDeviceID>.size
        var ids = [AudioDeviceID](repeating: 0, count: count)
        guard AudioObjectGetPropertyData(systemObject(), &address, 0, nil, &size, &ids) == noErr
        else { return [] }
        return ids
    }

    static func inputChannelCount(_ id: AudioDeviceID) -> Int {
        var address = globalAddress(kAudioDevicePropertyStreamConfiguration,
                                    scope: kAudioDevicePropertyScopeInput)
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(id, &address, 0, nil, &size) == noErr, size > 0
        else { return 0 }
        let raw = UnsafeMutableRawPointer.allocate(
            byteCount: Int(size),
            alignment: MemoryLayout<AudioBufferList>.alignment
        )
        defer { raw.deallocate() }
        guard AudioObjectGetPropertyData(id, &address, 0, nil, &size, raw) == noErr else {
            return 0
        }
        let abl = UnsafeMutableAudioBufferListPointer(
            raw.assumingMemoryBound(to: AudioBufferList.self)
        )
        return abl.reduce(0) { $0 + Int($1.mNumberChannels) }
    }

    static func defaultInputDeviceID() -> AudioDeviceID? {
        var address = globalAddress(kAudioHardwarePropertyDefaultInputDevice)
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)
        var value: AudioDeviceID = 0
        guard AudioObjectGetPropertyData(systemObject(), &address, 0, nil, &size, &value) == noErr,
              value != kAudioObjectUnknown
        else { return nil }
        return value
    }

    static func transportName(_ id: AudioDeviceID) -> String {
        guard let raw = uint32Property(id, kAudioDevicePropertyTransportType) else {
            return "unknown"
        }
        switch raw {
        case kAudioDeviceTransportTypeBuiltIn: return "builtin"
        case kAudioDeviceTransportTypeUSB: return "usb"
        case kAudioDeviceTransportTypeAggregate: return "aggregate"
        case kAudioDeviceTransportTypeVirtual: return "virtual"
        case kAudioDeviceTransportTypeBluetooth: return "bluetooth"
        case kAudioDeviceTransportTypeBluetoothLE: return "bluetooth-le"
        case kAudioDeviceTransportTypeHDMI: return "hdmi"
        case kAudioDeviceTransportTypeDisplayPort: return "displayport"
        case kAudioDeviceTransportTypeAirPlay: return "airplay"
        case kAudioDeviceTransportTypeThunderbolt: return "thunderbolt"
        case kAudioDeviceTransportTypeFireWire: return "firewire"
        case kAudioDeviceTransportTypePCI: return "pci"
        case kAudioDeviceTransportTypeAVB: return "avb"
        case kAudioDeviceTransportTypeUnknown: return "unknown"
        default: return "other"
        }
    }

    /// Enumerate INPUT-capable devices (input channel count > 0), in HAL order.
    static func inputDevices() -> [AudioDeviceInfo] {
        let defaultID = defaultInputDeviceID()
        var out: [AudioDeviceInfo] = []
        for id in allDeviceIDs() {
            let channels = inputChannelCount(id)
            guard channels > 0 else { continue }
            guard let uid = stringProperty(id, kAudioDevicePropertyDeviceUID), !uid.isEmpty
            else { continue } // a device with no UID is not addressable; skip
            let name = stringProperty(id, kAudioObjectPropertyName) ?? uid
            let manufacturer = stringProperty(id, kAudioObjectPropertyManufacturer) ?? ""
            let sampleRate = float64Property(id, kAudioDevicePropertyNominalSampleRate) ?? 0
            out.append(AudioDeviceInfo(
                id: id,
                uid: uid,
                name: name,
                manufacturer: manufacturer,
                transport: transportName(id),
                inputChannels: channels,
                sampleRate: sampleRate,
                isDefaultInput: defaultID == id
            ))
        }
        return out
    }

    static func deviceID(forUID uid: String) -> AudioDeviceID? {
        return inputDevices().first(where: { $0.uid == uid })?.id
    }

    // MARK: hot-plug

    private static var listenerInstalled = false
    private static let listenerQueue = DispatchQueue(label: "presentflow.audio.hotplug")

    /// Register a kAudioHardwarePropertyDevices listener. Fires on
    /// connect/disconnect of ANY audio device. Idempotent.
    static func installHotPlugListener(_ onChange: @escaping () -> Void) {
        guard !listenerInstalled else { return }
        listenerInstalled = true
        var address = globalAddress(kAudioHardwarePropertyDevices)
        let status = AudioObjectAddPropertyListenerBlock(
            systemObject(), &address, listenerQueue
        ) { _, _ in
            onChange()
        }
        if status != noErr {
            listenerInstalled = false
        }
    }
}
