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
    open: 'Linux has not given your user permission to use this printer.',
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

export class UsbTransport {
  static async request(filters) {
    const device = await navigator.usb.requestDevice({ filters });
    const t = new UsbTransport(device);
    await t.open();
    return t;
  }

  constructor(device) {
    this.device = device;
    this.label = device.productName || 'USB printer';
  }

  async open() {
    const d = this.device;
    try {
      await d.open();
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
      return;
    }
    throw new Error('No bulk OUT endpoint found on this device.');
  }

  async write(bytes) {
    for (let off = 0; off < bytes.length; off += USB_CHUNK) {
      const r = await this.device.transferOut(this.epOut, bytes.subarray(off, off + USB_CHUNK));
      if (r.status !== 'ok') throw new Error(`USB write failed: ${r.status}`);
    }
  }

  async read(length, timeoutMs = 2000) {
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
    try {
      await this.device.releaseInterface(this.interfaceNumber);
    } catch { /* already gone */ }
    await this.device.close();
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

  async close() {
    await this.port.close();
  }
}
