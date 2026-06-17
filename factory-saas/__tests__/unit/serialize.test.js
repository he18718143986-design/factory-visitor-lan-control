'use strict';

const { serializeSession, normalizeLoadedSession } = require('../../sessions/serialize');

describe('sessions/serialize', () => {
  describe('serializeSession', () => {
    const baseSession = {
      id: 'sess-1',
      subscriptionId: 'sub-1',
      visitorName: '张三',
      visitorCompany: 'ABC',
      area: '生产车间',
      wifiSsid: 'Factory-WiFi',
      status: 'waiting',
      deviceId: 'dev-123',
      deviceIp: '192.168.1.100',
      createdAt: new Date('2024-01-01'),
      restrictedAt: new Date('2024-01-01T10:00:00'),
      exitedAt: null,
      logs: ['[10:00] 签到'],
      entryQR: 'data:image/png;base64,abc',
      exitQR: 'data:image/png;base64,xyz',
      selfCheckin: true,
      recoverPairingEnabled: false,
      recoverPairingEnabledUntil: null,
      pairedNotConnectedReason: '',
      tamperDetected: false,
      tamperDetails: [],
    };

    it('serializes all expected fields', () => {
      const s = serializeSession(baseSession);
      expect(s.id).toBe('sess-1');
      expect(s.subscriptionId).toBe('sub-1');
      expect(s.visitorName).toBe('张三');
      expect(s.visitorCompany).toBe('ABC');
      expect(s.area).toBe('生产车间');
      expect(s.status).toBe('waiting');
      expect(s.deviceId).toBe('dev-123');
      expect(s.deviceIp).toBe('192.168.1.100');
      expect(s.selfCheckin).toBe(true);
      expect(s.tamperDetected).toBe(false);
    });

    it('handles missing optional fields gracefully', () => {
      const minimal = { id: 'x', subscriptionId: 'y', visitorName: 'A', area: 'B', status: 'waiting', createdAt: new Date() };
      const s = serializeSession(minimal);
      expect(s.visitorCompany).toBe('');
      expect(s.deviceId).toBeNull();
      expect(s.deviceIp).toBeNull();
      expect(s.logs).toEqual([]);
      expect(s.entryQR).toBe('');
      expect(s.exitQR).toBe('');
      expect(s.selfCheckin).toBe(false);
      expect(s.pairedNotConnectedReason).toBe('');
      expect(s.tamperDetails).toEqual([]);
    });

    it('coerces boolean fields', () => {
      const s = serializeSession({ ...baseSession, selfCheckin: 1, tamperDetected: 0 });
      expect(s.selfCheckin).toBe(true);
      expect(s.tamperDetected).toBe(false);
    });
  });

  describe('normalizeLoadedSession', () => {
    it('returns null for falsy input', () => {
      expect(normalizeLoadedSession(null)).toBeNull();
      expect(normalizeLoadedSession(undefined)).toBeNull();
    });

    it('returns null when id is missing', () => {
      expect(normalizeLoadedSession({ status: 'waiting' })).toBeNull();
    });

    it('converts date strings to Date objects', () => {
      const raw = {
        id: 'test',
        createdAt: '2024-01-01T00:00:00.000Z',
        restrictedAt: '2024-01-02T00:00:00.000Z',
        exitedAt: '2024-01-03T00:00:00.000Z',
      };
      const s = normalizeLoadedSession(raw);
      expect(s.createdAt).toBeInstanceOf(Date);
      expect(s.restrictedAt).toBeInstanceOf(Date);
      expect(s.exitedAt).toBeInstanceOf(Date);
    });

    it('ensures logs is an array', () => {
      const s = normalizeLoadedSession({ id: 'test', logs: 'not-array' });
      expect(s.logs).toEqual([]);
    });

    it('preserves existing array logs', () => {
      const s = normalizeLoadedSession({ id: 'test', logs: ['a', 'b'] });
      expect(s.logs).toEqual(['a', 'b']);
    });
  });
});
