'use strict';

const { _shellSplit: shellSplit, _parseDevices: parseDevices } = require('../../adb');

describe('shellSplit', () => {
  it('splits simple args', () => {
    expect(shellSplit('devices')).toEqual(['devices']);
  });

  it('splits -s serial shell command', () => {
    expect(shellSplit('-s 192.168.1.100:5555 shell pm list packages'))
      .toEqual(['-s', '192.168.1.100:5555', 'shell', 'pm', 'list', 'packages']);
  });

  it('keeps double-quoted string as one arg', () => {
    expect(shellSplit('-s ID shell "cat /tmp/file 2>/dev/null"'))
      .toEqual(['-s', 'ID', 'shell', 'cat /tmp/file 2>/dev/null']);
  });

  it('keeps single-quoted string as one arg', () => {
    expect(shellSplit("-s ID shell 'echo hello world'"))
      .toEqual(['-s', 'ID', 'shell', 'echo hello world']);
  });

  it('handles double-quoted string with pipes and &&', () => {
    expect(shellSplit('-s ID shell "pm list packages | grep camera && echo 1 || echo 0"'))
      .toEqual(['-s', 'ID', 'shell', 'pm list packages | grep camera && echo 1 || echo 0']);
  });

  it('handles escaped characters inside double quotes', () => {
    expect(shellSplit('-s ID shell "settings put secure sysui_qs_tiles \\"value\\""'))
      .toEqual(['-s', 'ID', 'shell', 'settings put secure sysui_qs_tiles "value"']);
  });

  it('handles multiple quoted segments', () => {
    expect(shellSplit("connect 10.0.0.1:5555"))
      .toEqual(['connect', '10.0.0.1:5555']);
  });

  it('handles empty string', () => {
    expect(shellSplit('')).toEqual([]);
  });

  it('handles extra whitespace', () => {
    expect(shellSplit('  -s  ID   shell   pm list  '))
      .toEqual(['-s', 'ID', 'shell', 'pm', 'list']);
  });

  it('does not interpret shell metacharacters without quotes', () => {
    // With execFile, these are literal args, not shell operators
    expect(shellSplit('-s ID shell pm suspend com.example.app'))
      .toEqual(['-s', 'ID', 'shell', 'pm', 'suspend', 'com.example.app']);
  });

  it('prevents command injection via device ID', () => {
    // A malicious deviceId like "ID; rm -rf /" becomes literal args, not a shell command
    const result = shellSplit('-s ID;rm -rf / shell pm list packages');
    expect(result).toEqual(['-s', 'ID;rm', '-rf', '/', 'shell', 'pm', 'list', 'packages']);
    // With execFile('adb', result), adb gets '-s' 'ID;rm' which is an invalid serial,
    // NOT a shell injection. The semicolon is treated as part of the serial string.
  });
});

describe('parseDevices', () => {
  it('parses device list', () => {
    const output = 'List of devices attached\n192.168.1.100:5555\tdevice\n10.0.0.1:5555\tdevice\n';
    expect(parseDevices(output)).toEqual(['192.168.1.100:5555', '10.0.0.1:5555']);
  });

  it('ignores unauthorized devices', () => {
    const output = 'List of devices attached\n192.168.1.100:5555\tunauthorized\n10.0.0.1:5555\tdevice\n';
    expect(parseDevices(output)).toEqual(['10.0.0.1:5555']);
  });

  it('returns empty for no devices', () => {
    expect(parseDevices('List of devices attached\n')).toEqual([]);
  });
});
