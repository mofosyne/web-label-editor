// Printer connection help, shown in a dialog. Content is per OS; when it is
// opened from a failed connection it highlights the step for that failure
// and fills in the printer's own USB IDs.

const KNOWN_DEVICES = [
  { name: 'DYMO LabelWriter', vendorId: 0x0922 },
  { name: 'Brother PT-P710BT', vendorId: 0x04f9, productId: 0x20af },
];

export function detectPlatform() {
  const p = (navigator.userAgentData?.platform || navigator.platform || '').toLowerCase();
  if (p.includes('win')) return 'windows';
  if (p.includes('mac')) return 'mac';
  if (p.includes('android')) return 'android';
  if (p.includes('chrome os') || p.includes('cros')) return 'chromeos';
  if (p.includes('linux')) return 'linux';
  return 'linux';
}

const hex4 = (n) => n.toString(16).padStart(4, '0');

function udevRules(device) {
  const devices = device ? [{ vendorId: device.vendorId, productId: device.productId }] : KNOWN_DEVICES;
  return devices.map((d) => {
    const product = d.productId != null ? `, ATTRS{idProduct}=="${hex4(d.productId)}"` : '';
    return `SUBSYSTEM=="usb", ATTRS{idVendor}=="${hex4(d.vendorId)}"${product}, TAG+="uaccess"`;
  });
}

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  Object.assign(e, attrs);
  e.append(...children.filter((c) => c != null));
  return e;
}

function commandBlock(text) {
  const copy = el('button', { type: 'button', textContent: 'Copy' });
  copy.onclick = async () => {
    try {
      await navigator.clipboard.writeText(text);
      copy.textContent = 'Copied';
      setTimeout(() => { copy.textContent = 'Copy'; }, 1500);
    } catch {
      copy.textContent = 'Select the text to copy';
    }
  };
  return el('div', { className: 'commands' }, el('pre', { textContent: text }), copy);
}

function step(title, highlighted, ...body) {
  return el('li', { className: highlighted ? 'step current' : 'step' }, el('strong', { textContent: title }), ...body);
}

const p = (text) => el('p', { textContent: text });

const GUIDES = {
  linux(ctx) {
    const rules = udevRules(ctx.device);
    const install = rules.length === 1
      ? `echo '${rules[0]}' | sudo tee /etc/udev/rules.d/60-label-printer.rules`
      : `sudo tee /etc/udev/rules.d/60-label-printer.rules <<'EOF'\n${rules.join('\n')}\nEOF`;
    return [
      el('li', { className: 'why' },
        p('Why this is needed: this editor talks to the printer directly over USB from your browser, which runs as you. Apps like glabels print through CUPS instead, whose USB backend runs as a system user, so they never needed this. Linux gives your desktop user access to scanners and cameras by default, but not to printers.'),
        p('CUPS printing keeps working alongside this; only one of the two can use the printer at a time.')),
      step('1. Allow your user to use the printer', ctx.stage === 'open',
        p('Linux only lets the browser open USB devices your user has permission for. This udev rule grants it to whoever is logged in at the desktop:'),
        commandBlock(`${install}\nsudo udevadm control --reload-rules && sudo udevadm trigger`),
        p('Fixes: "Failed to execute \'open\' on \'USBDevice\': Access denied".')),
      step('2. Unplug the printer and plug it back in', false,
        p('The new permission applies when the device is reconnected.')),
      step('3. If it now says the interface can\'t be claimed', ctx.stage === 'claim',
        p('The usblp kernel printer driver has grabbed the printer. Unload it and stop it loading again. CUPS on mainstream distros talks to USB printers without it; if CUPS printing stops working afterwards, delete the blacklist file.'),
        commandBlock("echo 'blacklist usblp' | sudo tee /etc/modprobe.d/no-usblp.conf\nsudo modprobe -r usblp"),
        p('Then unplug and replug the printer.')),
      step('Using Chromium from a snap?', false,
        p('Snaps are sandboxed and need USB access granted once:'),
        commandBlock('sudo snap connect chromium:raw-usb')),
    ];
  },
  windows(ctx) {
    return [
      step('Why it fails', ctx.stage != null,
        p('Windows attaches its own printer driver to the printer, and a USB device can only have one owner, so the browser is refused.')),
      step('Option A: Bluetooth (Brother PT-P710BT only)', false,
        p('Pair the printer in Windows Settings → Bluetooth, then use "Connect Bluetooth / serial" here. No driver changes needed.')),
      step('Option B: switch the printer to WinUSB with Zadig', false,
        el('ol', {},
          el('li', {}, 'Download Zadig from ', el('a', { href: 'https://zadig.akeo.ie/', target: '_blank', rel: 'noopener', textContent: 'zadig.akeo.ie' }), ' and run it.'),
          el('li', { textContent: 'Options → List All Devices, then pick the printer.' }),
          el('li', { textContent: 'Choose WinUSB as the target driver and click Replace Driver.' }),
          el('li', { textContent: 'Unplug and replug the printer, then connect again.' })),
        p('DYMO Connect / P-touch Editor stop seeing the printer until you reinstall their driver (Device Manager → Update driver).')),
    ];
  },
  mac(ctx) {
    return [
      step('Another program has the printer', ctx.stage != null,
        p('macOS lets only one program use the printer at a time. Quit DYMO Connect, the DYMO Web Service (menu bar icon) or P-touch Editor.')),
      step('Unplug the printer and plug it back in', false, p('Then connect again.')),
    ];
  },
  chromeos(ctx) {
    return [
      step('Remove the printer from ChromeOS printing', ctx.stage != null,
        p('If the printer was added under Settings → Printers, ChromeOS holds it. Remove it there, unplug and replug, then connect again.')),
    ];
  },
  android(ctx) {
    return [
      step('Allow USB access', ctx.stage != null,
        p('Unplug and replug the printer, and allow the browser to use it when Android asks.')),
    ];
  },
};

const TABS = [['linux', 'Linux'], ['windows', 'Windows'], ['mac', 'macOS'], ['chromeos', 'ChromeOS'], ['android', 'Android']];

// ctx: { os, stage: 'open' | 'claim' | undefined, device, error, onRetry }
export function openHelp(dialog, ctx) {
  let os = ctx.os ?? detectPlatform();
  const render = () => {
    const tabs = el('div', { className: 'tabs', role: 'tablist' }, ...TABS.map(([id, name]) => {
      const b = el('button', { type: 'button', textContent: name, className: id === os ? 'tab active' : 'tab' });
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(id === os));
      b.onclick = () => { os = id; render(); };
      return b;
    }));
    const close = el('button', { type: 'button', className: 'close', textContent: '×', ariaLabel: 'Close' });
    close.onclick = () => dialog.close();
    const actions = el('div', { className: 'row' });
    if (ctx.onRetry) {
      const retry = el('button', { type: 'button', className: 'primary', textContent: 'Try again' });
      retry.onclick = () => { dialog.close(); ctx.onRetry(); };
      actions.append(retry);
    }
    const done = el('button', { type: 'button', textContent: 'Close' });
    done.onclick = () => dialog.close();
    actions.append(done);

    dialog.replaceChildren(
      el('header', {}, el('h2', { textContent: 'Connecting a USB printer' }), close),
      ctx.error ? el('p', { className: 'error-detail', textContent: `Browser said: ${ctx.error}` }) : null,
      tabs,
      el('ol', { className: 'steps' }, ...GUIDES[os](os === (ctx.os ?? detectPlatform()) ? ctx : {})),
      actions,
    );
  };
  render();
  if (!dialog.open) dialog.showModal();
}
