import { describe, expect, it } from 'vitest';

import {
  classifyMessage,
  decideGuard,
  guardNeedsSession,
  type GuardInput,
  type MessageClass,
} from '@/bot/sessions/textSessionRouting.js';
import type { TextSessionInfo } from '@/bot/sessions/textSessionRegistry.js';
import { MENU_BUTTONS } from '@/bot/ui/mainMenu.js';

const BLOCKING: TextSessionInfo = {
  namespace: 'tc',
  name: 'создание турнира',
  blocking: true,
  callbackPrefix: 'tc:',
};

const SOFT: TextSessionInfo = {
  namespace: 'match-schedule',
  name: 'назначение времени матча',
  blocking: false,
  callbackPrefix: undefined,
};

const msg = (cls: MessageClass): GuardInput => ({ kind: 'message', cls });
const cb = (data: string): GuardInput => ({ kind: 'callback', data });

describe('classifyMessage', () => {
  it.each([
    ['/cancel', 'cancel'],
    ['/cancel@cue_bot', 'cancel'],
    ['/CANCEL', 'cancel'],
    ['/cancel now', 'cancel'],
    ['/start', 'command'],
    ['/start t_123', 'command'],
    ['/cancelled', 'command'],
    ['74-15', 'text'],
    ['21.06.2026 18:30', 'text'],
    ['@player', 'text'],
    ['-', 'text'],
  ] as const)('%s → %s', (text, expected) => {
    expect(classifyMessage(text)).toBe(expected);
  });

  it.each(Object.values(MENU_BUTTONS))('menu button %s → menu', (text) => {
    expect(classifyMessage(text)).toBe('menu');
  });
});

describe('decideGuard', () => {
  it('passes everything without an active session', () => {
    for (const input of [
      cb('match:view:1'),
      msg('command'),
      msg('menu'),
      msg('text'),
      msg('cancel'),
      { kind: 'other' } as const,
    ]) {
      expect(decideGuard(undefined, input)).toBe('pass');
    }
  });

  describe('blocking session', () => {
    it('passes its own callbacks and blocks foreign ones', () => {
      expect(decideGuard(BLOCKING, cb('tc:format:x'))).toBe('pass');
      expect(decideGuard(BLOCKING, cb('match:view:1'))).toBe('block-callback');
    });

    it('passes /cancel and plain text', () => {
      expect(decideGuard(BLOCKING, msg('cancel'))).toBe('pass');
      expect(decideGuard(BLOCKING, msg('text'))).toBe('pass');
    });

    it('blocks other commands and menu buttons (not taken as wizard input)', () => {
      expect(decideGuard(BLOCKING, msg('command'))).toBe('block-message');
      expect(decideGuard(BLOCKING, msg('menu'))).toBe('block-message');
    });

    it('passes non-text updates', () => {
      expect(decideGuard(BLOCKING, { kind: 'other' })).toBe('pass');
    });
  });

  describe('soft session', () => {
    it('passes any callback, /cancel and plain text', () => {
      expect(decideGuard(SOFT, cb('match:view:1'))).toBe('pass');
      expect(decideGuard(SOFT, cb('pe:edit:name'))).toBe('pass');
      expect(decideGuard(SOFT, msg('cancel'))).toBe('pass');
      expect(decideGuard(SOFT, msg('text'))).toBe('pass');
    });

    it('ends the session on a command or menu button, then passes', () => {
      expect(decideGuard(SOFT, msg('command'))).toBe('end-then-pass');
      expect(decideGuard(SOFT, msg('menu'))).toBe('end-then-pass');
    });
  });
});

describe('guardNeedsSession', () => {
  it('loads the session only when the decision can differ from pass', () => {
    expect(guardNeedsSession(cb('x'))).toBe(true);
    expect(guardNeedsSession(msg('command'))).toBe(true);
    expect(guardNeedsSession(msg('menu'))).toBe(true);
    expect(guardNeedsSession(msg('text'))).toBe(false);
    expect(guardNeedsSession(msg('cancel'))).toBe(false);
    expect(guardNeedsSession({ kind: 'other' })).toBe(false);
  });

  it('is consistent with decideGuard', () => {
    const inputs: GuardInput[] = [
      cb('tc:x'),
      cb('y'),
      msg('command'),
      msg('menu'),
      msg('text'),
      msg('cancel'),
      { kind: 'other' },
    ];
    for (const input of inputs) {
      if (guardNeedsSession(input)) continue;
      for (const active of [undefined, BLOCKING, SOFT]) {
        expect(decideGuard(active, input)).toBe('pass');
      }
    }
  });
});
