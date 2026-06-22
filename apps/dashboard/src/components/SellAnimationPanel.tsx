import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

const MONEY = ["💸", "💰", "🤑", "💵", "🪙", "💲", "🏦"];

type Particle = {
  id: number;
  left: number; // %
  size: number; // px
  delay: number; // s
  duration: number; // s
  drift: number; // px horizontal drift
  rot: number; // deg
  emoji: string;
};

export default function SellAnimationPanel() {
  const [active, setActive] = useState(false);
  const [shown, setShown] = useState(false);
  const [particles, setParticles] = useState<Particle[]>([]);
  const timerRef = useRef<number | null>(null);
  const seedRef = useRef(0);

  const trigger = useCallback(() => {
    seedRef.current += 1;
    const seed = seedRef.current;

    const n = 28;
    const next: Particle[] = Array.from({ length: n }, (_, i) => ({
      id: seed * 1000 + i,
      left: Math.random() * 100,
      size: 30 + Math.random() * 44,
      delay: Math.random() * 0.7,
      duration: 1.9 + Math.random() * 1.8,
      drift: (Math.random() * 2 - 1) * 60,
      rot: (Math.random() * 2 - 1) * 220,
      emoji: MONEY[Math.floor(Math.random() * MONEY.length)],
    }));
    setParticles(next);
    setActive(true);
    setShown(true);

    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setActive(false);
      setParticles([]);
    }, 4200);
  }, []);

  useEffect(() => {
    const handler = () => trigger();
    window.addEventListener("sell:tool-result", handler);
    return () => window.removeEventListener("sell:tool-result", handler);
  }, [trigger]);

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);

  const styles = useMemo(
    () => `
    .sellRoot{
      position: relative;
      border-radius: 16px;
      overflow: hidden;
      min-height: 380px;
      display: flex;
      flex-direction: column;
      background: rgba(2,6,23,0.35);
      border: 1px solid rgba(148,163,184,0.22);
      color: rgba(255,255,255,0.92);
    }
    .sellHeader{
      display:flex; align-items:center; justify-content:space-between;
      gap:12px; padding:24px 16px 24px;
    }
    .sellTitle{ display:flex; align-items:center; gap:10px; }
    .sellTitleText .t1{ font-size:14px; font-weight:750; line-height:1.1; }

    .sellCanvas{
      position: relative; flex:1; margin:6px 12px 0; border-radius:14px;
      min-height: 250px;
      background:
        radial-gradient(520px 280px at 50% 30%, rgba(255,255,255,0.05), transparent 60%),
        linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.015));
      border:1px solid rgba(255,255,255,0.10);
      overflow:hidden;
    }
    .money{
      position:absolute; top:-60px;
      will-change: transform, opacity;
      filter: drop-shadow(0 8px 14px rgba(0,0,0,0.35));
      animation-name: moneyFall;
      animation-timing-function: cubic-bezier(.35,.15,.4,1);
      animation-fill-mode: both;
    }
    @keyframes moneyFall{
      0%   { transform: translate(0, -60px) rotate(0deg); opacity: 0; }
      8%   { opacity: 1; }
      100% { transform: translate(var(--drift), 330px) rotate(var(--rot)); opacity: 0; }
    }

    .sellCenter{
      position:absolute; inset:0; display:flex; flex-direction:column;
      align-items:center; justify-content:center; text-align:center; gap:8px;
      pointer-events:none;
    }
    .sellCenter .big{
      font-size: 46px; font-weight: 900; letter-spacing: 0.5px;
      opacity: 0; transform: scale(0.7);
      text-shadow: 0 6px 30px rgba(124,92,255,0.40);
      transition: opacity 300ms ease;
    }
    .sellCenter .sub{
      font-size: 14px; color: rgba(255,255,255,0.7); opacity: 0;
      transition: opacity 300ms ease;
    }
    /* Once triggered, keep the text on screen (persists after the rain). */
    .sellRoot.shown .sellCenter .big{ opacity: 1; transform: scale(1); }
    .sellRoot.shown .sellCenter .sub{ opacity: 1; }
    /* Quick pop on each trigger; settles visible. */
    .sellRoot.active .sellCenter .big{ animation: pop 900ms ease-out both; }
    @keyframes pop{
      0%{ opacity:0; transform: scale(0.6); }
      45%{ opacity:1; transform: scale(1.14); }
      100%{ opacity:1; transform: scale(1); }
    }
  `,
    []
  );

  return (
    <div className={`sellRoot ${active ? "active" : ""} ${shown ? "shown" : ""}`}>
      <style>{styles}</style>

      <div className="sellHeader">
        <div className="sellTitle">
          <div className="sellTitleText">
            <div className="t1">Actions</div>
          </div>
        </div>
      </div>

      <div className="sellCanvas" role="img" aria-label="Money sell animation">
        {particles.map((p) => (
          <span
            key={p.id}
            className="money"
            style={
              {
                left: `${p.left}%`,
                fontSize: `${p.size}px`,
                animationDelay: `${p.delay}s`,
                animationDuration: `${p.duration}s`,
                ["--drift" as any]: `${p.drift}px`,
                ["--rot" as any]: `${p.rot}deg`,
              } as CSSProperties
            }
          >
            {p.emoji}
          </span>
        ))}

        <div className="sellCenter" aria-hidden="true">
          <div className="big">SELL! 💸</div>
          <div className="sub">Cha-ching — cashing out 🤑</div>
        </div>
      </div>
    </div>
  );
}
