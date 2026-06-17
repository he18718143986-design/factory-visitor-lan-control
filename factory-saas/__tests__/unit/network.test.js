'use strict';

const { getClientIp, ipToSubnet, isSameSubnet, isValidIPv4, isPrivateIPv4 } = require('../../utils/network');

describe('utils/network', () => {
  describe('getClientIp', () => {
    it('extracts from x-forwarded-for header', () => {
      const req = { headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' }, socket: {} };
      expect(getClientIp(req)).toBe('203.0.113.5');
    });

    it('extracts from socket remoteAddress', () => {
      const req = { headers: {}, socket: { remoteAddress: '192.168.1.10' } };
      expect(getClientIp(req)).toBe('192.168.1.10');
    });

    it('strips IPv6-mapped prefix', () => {
      const req = { headers: {}, socket: { remoteAddress: '::ffff:10.0.0.5' } };
      expect(getClientIp(req)).toBe('10.0.0.5');
    });

    it('handles missing headers/socket', () => {
      const req = { headers: {}, ip: '127.0.0.1' };
      expect(getClientIp(req)).toBe('127.0.0.1');
    });
  });

  describe('ipToSubnet', () => {
    it('returns /24 subnet', () => {
      expect(ipToSubnet('192.168.1.100')).toBe('192.168.1');
    });

    it('returns null for invalid IP', () => {
      expect(ipToSubnet('invalid')).toBeNull();
      expect(ipToSubnet('1.2.3')).toBeNull();
    });
  });

  describe('isSameSubnet', () => {
    it('returns true for same /24', () => {
      expect(isSameSubnet('192.168.1.10', '192.168.1.200')).toBe(true);
    });

    it('returns false for different /24', () => {
      expect(isSameSubnet('192.168.1.10', '192.168.2.10')).toBe(false);
    });
  });

  describe('isValidIPv4', () => {
    it('accepts valid IPs', () => {
      expect(isValidIPv4('192.168.1.1')).toBe(true);
      expect(isValidIPv4('10.0.0.1')).toBe(true);
      expect(isValidIPv4('255.255.255.255')).toBe(true);
    });

    it('rejects invalid IPs', () => {
      expect(isValidIPv4('abc')).toBe(false);
      expect(isValidIPv4('1.2.3')).toBe(false);
      expect(isValidIPv4('')).toBe(false);
      expect(isValidIPv4('::1')).toBe(false);
    });
  });

  describe('isPrivateIPv4', () => {
    it('accepts 10.x.x.x', () => {
      expect(isPrivateIPv4('10.0.0.1')).toBe(true);
      expect(isPrivateIPv4('10.255.255.255')).toBe(true);
    });

    it('accepts 172.16-31.x.x', () => {
      expect(isPrivateIPv4('172.16.0.1')).toBe(true);
      expect(isPrivateIPv4('172.31.255.255')).toBe(true);
    });

    it('rejects 172.15.x.x and 172.32.x.x', () => {
      expect(isPrivateIPv4('172.15.0.1')).toBe(false);
      expect(isPrivateIPv4('172.32.0.1')).toBe(false);
    });

    it('accepts 192.168.x.x', () => {
      expect(isPrivateIPv4('192.168.1.100')).toBe(true);
      expect(isPrivateIPv4('192.168.0.1')).toBe(true);
    });

    it('accepts 127.x.x.x (loopback)', () => {
      expect(isPrivateIPv4('127.0.0.1')).toBe(true);
    });

    it('rejects public IPs', () => {
      expect(isPrivateIPv4('8.8.8.8')).toBe(false);
      expect(isPrivateIPv4('203.0.113.5')).toBe(false);
      expect(isPrivateIPv4('1.1.1.1')).toBe(false);
    });

    it('rejects invalid inputs', () => {
      expect(isPrivateIPv4('not-an-ip')).toBe(false);
      expect(isPrivateIPv4('')).toBe(false);
      expect(isPrivateIPv4('::1')).toBe(false);
    });
  });
});
