'use strict';

const { serializeSession } = require('../../sessions/serialize');

describe('sessions/serialize integration', () => {
  it('round-trips through JSON serialize/parse', () => {
    const session = {
      id: 'sess-rt-1',
      subscriptionId: 'sub-rt',
      visitorName: '李四',
      visitorCompany: 'XYZ Corp',
      area: '研发中心',
      wifiSsid: 'Dev-WiFi',
      status: 'restricted',
      deviceId: 'dev-456',
      deviceIp: '10.0.0.50',
      createdAt: new Date('2024-06-01T09:00:00Z'),
      restrictedAt: new Date('2024-06-01T09:10:00Z'),
      exitedAt: null,
      logs: ['[09:00] 签到', '[09:10] 管控启用'],
      entryQR: 'data:image/png;base64,entry',
      exitQR: 'data:image/png;base64,exit',
      selfCheckin: true,
      recoverPairingEnabled: true,
      recoverPairingEnabledUntil: '2024-06-01T09:30:00Z',
      pairedNotConnectedReason: '',
      tamperDetected: true,
      tamperDetails: [{ type: 'accessibility_off', ts: Date.now() }],
    };

    const serialized = serializeSession(session);
    const json = JSON.stringify(serialized);
    const parsed = JSON.parse(json);

    expect(parsed.id).toBe('sess-rt-1');
    expect(parsed.status).toBe('restricted');
    expect(parsed.selfCheckin).toBe(true);
    expect(parsed.tamperDetected).toBe(true);
    expect(parsed.tamperDetails).toHaveLength(1);
    expect(parsed.logs).toHaveLength(2);
    expect(parsed.recoverPairingEnabled).toBe(true);
  });

  it('handles all valid session statuses', () => {
    const statuses = ['waiting', 'pairing', 'restricted', 'exited', 'error', 'paired_not_connected'];
    statuses.forEach(status => {
      const s = serializeSession({
        id: `s-${status}`,
        subscriptionId: 'sub-1',
        visitorName: 'Test',
        area: 'A',
        status,
        createdAt: new Date(),
      });
      expect(s.status).toBe(status);
    });
  });

  it('handles empty tamperDetails gracefully', () => {
    const s = serializeSession({
      id: 'td-test',
      subscriptionId: 'sub',
      visitorName: 'V',
      area: 'A',
      status: 'waiting',
      createdAt: new Date(),
      tamperDetails: 'not-an-array',
    });
    expect(s.tamperDetails).toEqual([]);
  });
});
