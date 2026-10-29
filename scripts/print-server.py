#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Web Label Editor print server: the reference for docs/PRINT-SERVER-API.md.

Hosts the editor and one label printer for every device on the network,
for example on a Raspberry Pi with the printer plugged into it. Open the
address it prints in any browser (phones, Firefox and Safari included):
the editor finds the printer by itself and Print sends labels here.

    python3 print-server.py --model dymo-lw450 --device /dev/usb/lp0
    python3 print-server.py --model brother-ql-570 --medium ql-62 \\
        --device /dev/usb/lp0 --name "Kitchen QL"
    python3 print-server.py --model dymo-lw450 --command "lp -d DYMO -o raw"

--model is the editor's printer id, listed in docs/PRINT-SERVER-API.md.
The editor sends the printer's own commands ("raw"), which go to --device
(a USB printer's /dev/usb/lp* node; its user needs to be in the lp group)
or into --command on its standard input. Standard library only.

Anyone who can reach the port can print: run it on a network you trust.
"""
import argparse
import json
import os
import shlex
import subprocess
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

API = 'web-label-print/1'
MAX_JOB = 32 * 1024 * 1024  # bytes; a long 600 dpi label is a few MB


def app_root():
    """The editor's files: beside this script (the offline download) or one
    folder up (the source repository, where this is scripts/)."""
    here = os.path.dirname(os.path.abspath(__file__))
    for root in (here, os.path.dirname(here)):
        if os.path.exists(os.path.join(root, 'index.html')):
            return root
    sys.exit('Could not find the editor (index.html) next to this script; use --root.')


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, info, args_, **kw):
        self.info = info
        self.args_ = args_
        super().__init__(*args, **kw)

    def do_GET(self):
        if self.path.split('?')[0].endswith('/printer.json'):
            body = json.dumps(self.info).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def do_POST(self):
        if not self.path.split('?')[0].endswith('/print'):
            return self.reply(404, 'Not found')
        length = int(self.headers.get('Content-Length') or 0)
        if not 0 < length <= MAX_JOB:
            return self.reply(413, 'The label is empty or too large.')
        job = self.rfile.read(length)
        try:
            if self.args_.device:
                # An unplugged printer's device is gone: don't create a file there.
                if not os.path.exists(self.args_.device):
                    raise FileNotFoundError(self.args_.device)
                with open(self.args_.device, 'wb') as printer:
                    printer.write(job)
            else:
                subprocess.run(shlex.split(self.args_.command), input=job, check=True,
                               timeout=120, capture_output=True)
        except PermissionError:
            return self.reply(500, f'The print server may not use {self.args_.device}: '
                                   'add the user it runs as to the lp group.')
        except FileNotFoundError:
            return self.reply(500, 'The printer is not connected to the print server '
                                   f'({self.args_.device or self.args_.command} not found).')
        except subprocess.CalledProcessError as err:
            detail = err.stderr.decode(errors='replace').strip() or f'exit status {err.returncode}'
            return self.reply(500, f'The print command failed: {detail}')
        except (OSError, subprocess.TimeoutExpired) as err:
            return self.reply(500, f'Could not print: {err}')
        self.reply(200, 'Printed')

    def reply(self, status, text):
        body = (text + '\n').encode()
        self.send_response(status)
        self.send_header('Content-Type', 'text/plain; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    p = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    p.add_argument('--model', required=True, help="the editor's printer id, e.g. dymo-lw450, brother-ql-570")
    p.add_argument('--medium', help="the label loaded, as the editor's media id (optional), e.g. 30252, ql-62")
    p.add_argument('--name', default='', help='a name for the printer, shown in the editor')
    out = p.add_mutually_exclusive_group(required=True)
    out.add_argument('--device', help='the printer device to write jobs to, e.g. /dev/usb/lp0')
    out.add_argument('--command', help='a command that takes each job on its standard input')
    p.add_argument('--port', type=int, default=8740)
    p.add_argument('--bind', default='0.0.0.0', help='address to listen on (default: every network)')
    p.add_argument('--root', default=None, help="the editor's folder (default: found next to this script)")
    args = p.parse_args()

    info = {'api': API, 'name': args.name, 'model': args.model, 'accepts': 'raw'}
    if args.medium:
        info['medium'] = args.medium
    handler = partial(Handler, info=info, args_=args, directory=args.root or app_root())
    server = ThreadingHTTPServer((args.bind, args.port), handler)
    print(f'Web Label Editor print server on port {args.port}: open http://<this computer>:{args.port}/')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
