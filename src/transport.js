// Transports deliver raw printer bytes. Both expose write(bytes),
// read(length, timeoutMs) and close().

import { detectPlatform } from './help.js';

const SPP_UUID = '00001101-0000-1000-8000-00805f9b34fb';
const USB_CHUNK = 4096;

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

const SHORT_REASON = {
  linux: {
    open: 'Linux refused the browser access to the printer\'s USB device (no permission yet, or a snap/Flatpak browser sandbox).',
    claim: 'Another driver or program is holding the printer (usually the usblp kernel driver, or CUPS while printing).',
  },
  windows: 'The Windows printer driver owns this printer, so the browser cannot use it.',
  mac: 'Another program (such as DYMO Connect) is using the printer.',
  chromeos: 'ChromeOS is holding the printer.',
  android: 'Android blocked access to the printer.',
};

// A short, OS-specific explanation; the app offers the full fix in a dialog.
function usbAccessError(err, stage, device) {
  const os = detectPlatform();
  const reason = SHORT_REASON[os];
  const e = new Error(typeof reason === 'string' ? reason : reason[stage]);
  e.usbProblem = { os, stage, device, error: err.message };
  return e;
}

export const support = {
  usb: typeof navigator !== 'undefined' && 'usb' in navigator,
  serial: typeof navigator !== 'undefined' && 'serial' in navigator,
};

// The printer's interface is claimed only while a job or status query runs
// (acquire/release), like CUPS does, so other programs can print in between.
export class UsbTransport {
  static async request(filters) {
    const device = await navigator.usb.requestDevice({ filters });
    const t = new UsbTransport(device);
    // Check access up front so permission problems show on Connect.
    await t.acquire();
    await t.release();
    return t;
  }

  // A printer this site was already allowed to use, without asking again:
  // used to reconnect after a reload or when it is plugged back in. Returns
  // null (quietly) if none matches or it can't be opened right now.
  static async reconnect(filters) {
    const matches = (d) => filters.some((f) => d.vendorId === f.vendorId
      && (f.productId == null || d.productId === f.productId)
      && (f.classCode == null || (d.configurations ?? []).some((c) => c.interfaces
        .some((i) => i.alternates.some((a) => a.interfaceClass === f.classCode)))));
    const device = (await navigator.usb.getDevices()).find(matches);
    if (!device) return null;
    const t = new UsbTransport(device);
    try {
      await t.acquire();
      await t.release();
      return t;
    } catch {
      return null;
    }
  }

  constructor(device) {
    this.device = device;
    this.label = device.productName || 'USB printer';
    this.held = false;
  }

  async acquire() {
    if (this.held) return;
    const d = this.device;
    try {
      if (!d.opened) await d.open();
    } catch (err) {
      throw usbAccessError(err, 'open', d);
    }
    if (!d.configuration) await d.selectConfiguration(1);

    // Prefer the USB Printer class interface; fall back to any with a bulk OUT.
    const candidates = [...d.configuration.interfaces].sort(
      (a, b) => (b.alternates[0].interfaceClass === 7) - (a.alternates[0].interfaceClass === 7),
    );
    for (const iface of candidates) {
      const alt = iface.alternates[0];
      const out = alt.endpoints.find((e) => e.type === 'bulk' && e.direction === 'out');
      if (!out) continue;
      try {
        await d.claimInterface(iface.interfaceNumber);
      } catch (err) {
        await d.close().catch(() => {});
        throw usbAccessError(err, 'claim', d);
      }
      this.interfaceNumber = iface.interfaceNumber;
      this.epOut = out.endpointNumber;
      this.epIn = alt.endpoints.find((e) => e.type === 'bulk' && e.direction === 'in')?.endpointNumber;
      this.held = true;
      return;
    }
    await d.close().catch(() => {});
    throw new Error('No bulk OUT endpoint found on this device.');
  }

  async release() {
    if (!this.held) return;
    this.held = false;
    try {
      await this.device.releaseInterface(this.interfaceNumber);
    } catch { /* already gone */ }
    try {
      await this.device.close();
    } catch { /* already closed */ }
  }

  async write(bytes) {
    await this.acquire();
    for (let off = 0; off < bytes.length; off += USB_CHUNK) {
      const r = await this.device.transferOut(this.epOut, bytes.subarray(off, off + USB_CHUNK));
      if (r.status !== 'ok') throw new Error(`USB write failed: ${r.status}`);
    }
  }

  async read(length, timeoutMs = 2000) {
    await this.acquire();
    if (this.epIn == null) throw new Error('Printer has no IN endpoint.');
    const out = new Uint8Array(length);
    let got = 0;
    const deadline = Date.now() + timeoutMs;
    while (got < length) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const r = await withTimeout(this.device.transferIn(this.epIn, 64), remaining, 'USB read timed out');
      if (r.data?.byteLength) {
        const chunk = new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength);
        out.set(chunk.subarray(0, length - got), got);
        got += chunk.length;
      }
    }
    return out.subarray(0, Math.min(got, length));
  }

  async close() {
    await this.release();
  }
}

export class SerialTransport {
  // Bluetooth printers show up as a serial port once paired with the OS, or
  // directly through the RFCOMM Serial Port Profile on recent Chromium.
  static async request() {
    const port = await navigator.serial.requestPort({ allowedBluetoothServiceClassIds: [SPP_UUID] });
    await port.open({ baudRate: 9600 });
    return new SerialTransport(port);
  }

  constructor(port) {
    this.port = port;
    const info = port.getInfo?.() ?? {};
    this.label = info.bluetoothServiceClassId ? 'Bluetooth' : 'Serial port';
  }

  async write(bytes) {
    const writer = this.port.writable.getWriter();
    try {
      await writer.write(bytes);
    } finally {
      writer.releaseLock();
    }
  }

  async read(length, timeoutMs = 2000) {
    const reader = this.port.readable.getReader();
    const out = new Uint8Array(length);
    let got = 0;
    const timer = setTimeout(() => reader.cancel(), timeoutMs);
    try {
      while (got < length) {
        const { value, done } = await reader.read();
        if (done) break;
        out.set(value.subarray(0, length - got), got);
        got += value.length;
      }
    } finally {
      clearTimeout(timer);
      reader.releaseLock();
    }
    return out.subarray(0, Math.min(got, length));
  }

  // A paired Bluetooth/serial port isn't shared with other programs anyway.
  async release() {}

  async close() {
    await this.port.close();
  }
}
