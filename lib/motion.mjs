// Motion presets shared by every generated composition (deterministic GSAP, fromTo only).
export const MOTION_JS = `
function __enter(p, k) {
  k = k || 1;
  switch (p) {
    case 'slam': return [{ opacity: 0, scale: 1.32, y: -26, rotation: -3 }, { opacity: 1, scale: 1, y: 0, rotation: 0, duration: 0.28 * k, ease: 'power4.out' }];
    case 'mask-up': return [{ opacity: 0, y: 36, clipPath: 'inset(100% 0% 0% 0%)' }, { opacity: 1, y: 0, clipPath: 'inset(0% 0% 0% 0%)', duration: 0.6 * k, ease: 'expo.out' }];
    case 'fade-rise': return [{ opacity: 0, y: 22 }, { opacity: 1, y: 0, duration: 0.85 * k, ease: 'power2.out' }];
    case 'pop': return [{ opacity: 0, scale: 0.55 }, { opacity: 1, scale: 1, duration: 0.24 * k, ease: 'back.out(2.2)' }];
    case 'slow-fade': return [{ opacity: 0 }, { opacity: 1, duration: 1.1 * k, ease: 'sine.out' }];
    case 'stamp': return [{ opacity: 0, scale: 2.1, rotation: -14 }, { opacity: 1, scale: 1, rotation: -6, duration: 0.22 * k, ease: 'power4.in' }];
    case 'float': return [{ opacity: 0, y: 30, scale: 0.9 }, { opacity: 1, y: 0, scale: 1, duration: 0.5 * k, ease: 'power3.out' }];
    case 'burst': return [{ opacity: 0, scale: 0.2, rotation: -25 }, { opacity: 1, scale: 1, rotation: 0, duration: 0.3 * k, ease: 'back.out(3)' }];
    default: return [{ opacity: 0 }, { opacity: 1, duration: 0.3 * k, ease: 'power1.out' }];
  }
}
function __in(tl, sel, t, p, k) { const v = __enter(p, k); tl.fromTo(sel, v[0], v[1], t); }
function __out(tl, sel, t, d) { tl.to(sel, { opacity: 0, duration: d || 0.2, ease: 'power1.in' }, t); }
`;
