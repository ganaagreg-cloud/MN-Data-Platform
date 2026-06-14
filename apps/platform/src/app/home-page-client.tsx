"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useSession } from "next-auth/react";
import { TelegramLoginButton } from "@/components/telegram-login-button";
import type { Plan } from "@/lib/plans";
import styles from "./page.module.css";

function cx(...classes: Array<string | false | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

const HERO_COUNTDOWN_START = 4 * 86400 + 12 * 3600 + 34 * 60 + 56;

function formatCountdown(totalSeconds: number): string {
  let s = totalSeconds;
  const days = Math.floor(s / 86400);
  s %= 86400;
  const hours = Math.floor(s / 3600);
  s %= 3600;
  const minutes = Math.floor(s / 60);
  const seconds = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${days} хоног ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

const sectionLabelStyle: CSSProperties = {
  margin: 0,
  fontSize: 12,
  letterSpacing: "0.22em",
  color: "#FFC107",
  textTransform: "uppercase",
};

const sectionHeadingStyle: CSSProperties = {
  margin: "12px 0 0",
  fontSize: "clamp(1.7rem, 3.8vw, 2.7rem)",
  fontWeight: 800,
  letterSpacing: "-0.03em",
  color: "#F2F2F0",
  lineHeight: 1.05,
};

const ICON_USER_PLUS = (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#FFC107" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
    <circle cx="9" cy="7" r="4"></circle>
    <line x1="19" y1="8" x2="19" y2="14"></line>
    <line x1="22" y1="11" x2="16" y2="11"></line>
  </svg>
);

const ICON_BRIEFCASE = (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#FFC107" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>
  </svg>
);

const ICON_BELL = (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#FFC107" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
    <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
  </svg>
);

const ICON_MAP_PIN = (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#FFC107" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
    <circle cx="12" cy="10" r="3"></circle>
  </svg>
);

const ICON_TRENDING_UP = (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#FFC107" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline>
    <polyline points="17 6 23 6 23 12"></polyline>
  </svg>
);

interface Step {
  number: string;
  icon: ReactNode;
  title: string;
  description: string;
  highlighted?: boolean;
}

const HOW_STEPS: Record<"tender" | "gazar", Step[]> = {
  tender: [
    {
      number: "01",
      icon: ICON_USER_PLUS,
      title: "Бүртгүүлнэ",
      description: "Telegram-ээр ганц товшилтоор. Нэр, нууц үг шаардахгүй.",
    },
    {
      number: "02",
      icon: ICON_BRIEFCASE,
      title: "Ангилал сонгоно",
      description: "Барилга, IT, тавилга, эм... сонирхсон чиглэлээ сонгоно.",
    },
    {
      number: "03",
      icon: ICON_BELL,
      title: "Тендер гармагц мэдэгдэл",
      description: "Шинэ тендер нийтлэгдмэгц Telegram-аар шууд танд ирнэ.",
      highlighted: true,
    },
  ],
  gazar: [
    {
      number: "01",
      icon: ICON_USER_PLUS,
      title: "Бүртгүүлнэ",
      description: "Telegram-ээр ганц товшилтоор. Нэр, нууц үг шаардахгүй.",
    },
    {
      number: "02",
      icon: ICON_MAP_PIN,
      title: "Дүүрэг сонгоно",
      description: "Хан-Уул, Сүхбаатар, Баянзүрх... хяналтад авах дүүргээ сонгоно.",
    },
    {
      number: "03",
      icon: ICON_TRENDING_UP,
      title: "Үнэ өөрчлөгдөхөд мэдэгдэл",
      description: "м² үнэ хөдөлмөгц Telegram-аар шууд мэдэгдэнэ.",
      highlighted: true,
    },
  ],
};

const STATS: Array<{ value: string; label: string }> = [
  { value: "8,000+", label: "тендерийн сан" },
  { value: "9", label: "дүүргийн үнэ" },
  { value: "24/7", label: "Telegram мэдэгдэл" },
  { value: "Өдөр бүр", label: "шинэчлэгдэнэ" },
];

interface LiveTenderCard {
  id: string;
  badge?: string;
  title: string;
  budget: string;
  category: string;
  countdown: string;
  countdownColor: string;
  highlighted?: boolean;
  delay: string;
}

const DATA_CARDS: LiveTenderCard[] = [
  {
    id: "TEND-2026-04812",
    badge: "ШИНЭ",
    title: "Улаанбаатар хотын Захирагчийн ажлын алба",
    budget: "₮2,400,000,000",
    category: "Зам, гүүр",
    countdown: "⏳ 4 хоног",
    countdownColor: "#FF8A5E",
    highlighted: true,
    delay: "0.04s",
  },
  {
    id: "TEND-2026-04798",
    title: "Боловсрол, шинжлэх ухааны яам",
    budget: "₮680,000,000",
    category: "IT, программ",
    countdown: "⏳ 9 хоног",
    countdownColor: "#A1A1AA",
    delay: "0.1s",
  },
  {
    id: "TEND-2026-04771",
    title: "Эрүүл мэндийн хөгжлийн төв",
    budget: "₮1,150,000,000",
    category: "Эмнэлгийн тоног",
    countdown: "⏳ 2 хоног",
    countdownColor: "#FF8A5E",
    delay: "0.16s",
  },
];

interface PricingFeature {
  text: string;
  emphasis?: boolean;
}

interface PricingTier {
  label: string;
  labelColor: string;
  price: string;
  priceColor: string;
  note?: string;
  featured?: boolean;
  features: PricingFeature[];
  featureColor: string;
  delay: string;
  plan: Plan;
}

const PRICING_TIERS: PricingTier[] = [
  {
    label: "Тендер",
    labelColor: "#A1A1AA",
    price: "₮150,000",
    priceColor: "#F2F2F0",
    plan: "tender",
    features: [
      { text: "8,000+ тендерийн сан" },
      { text: "Ангилалаар шүүлт" },
      { text: "Telegram мэдэгдэл" },
      { text: "Өдөр бүр шинэчлэлт" },
    ],
    featureColor: "#C7C7CC",
    delay: "0.05s",
  },
  {
    label: "Хослол",
    labelColor: "#FFD66B",
    price: "₮250,000",
    priceColor: "#FFC107",
    note: "₮50,000 хэмнэнэ · хоёр бүтээгдэхүүн",
    featured: true,
    plan: "both",
    features: [
      { text: "Тендер + Үл хөдлөх — бүгд", emphasis: true },
      { text: "8,000+ тендер + 9 дүүрэг" },
      { text: "Хязгааргүй Telegram мэдэгдэл" },
      { text: "Тэргүүлэх дэмжлэг" },
    ],
    featureColor: "#EDEDEC",
    delay: "0.1s",
  },
  {
    label: "Үл хөдлөх",
    labelColor: "#A1A1AA",
    price: "₮150,000",
    priceColor: "#F2F2F0",
    plan: "gazar",
    features: [
      { text: "9 дүүргийн үнэ" },
      { text: "м² үнийн хандлага" },
      { text: "Telegram мэдэгдэл" },
      { text: "Өдөр бүр шинэчлэлт" },
    ],
    featureColor: "#C7C7CC",
    delay: "0.15s",
  },
];

function FeatureItem({ text, color, emphasis }: { text: string; color: string; emphasis?: boolean | undefined }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
      <span style={{ color: "#FFC107", flexShrink: 0, fontSize: 14, marginTop: 1 }}>✓</span>
      <span style={{ fontSize: 14, color, lineHeight: 1.4, fontWeight: emphasis ? 500 : undefined }}>{text}</span>
    </div>
  );
}

function StepCard({ step }: { step: Step }) {
  const highlighted = step.highlighted ?? false;
  return (
    <div
      style={{
        border: highlighted ? "1px solid rgba(255,193,7,0.3)" : "1px solid rgba(255,255,255,0.09)",
        borderRadius: 12,
        background: highlighted ? "rgba(255,193,7,0.05)" : "#111214",
        padding: 26,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span
          className={cx(styles.mono)}
          style={{
            fontSize: "2.2rem",
            fontWeight: 700,
            color: highlighted ? "rgba(255,193,7,0.4)" : "rgba(255,193,7,0.28)",
            lineHeight: 1,
          }}
        >
          {step.number}
        </span>
        {step.icon}
      </div>
      <h3 style={{ margin: "18px 0 0", fontSize: "1.18rem", fontWeight: 700, color: highlighted ? "#FFD66B" : "#F2F2F0", letterSpacing: "-0.01em" }}>
        {step.title}
      </h3>
      <p style={{ margin: "9px 0 0", fontSize: 14.5, lineHeight: 1.55, color: highlighted ? "#C7C7CC" : "#A1A1AA" }}>{step.description}</p>
    </div>
  );
}

function DataCard({ card }: { card: LiveTenderCard }) {
  const highlighted = card.highlighted ?? false;
  return (
    <div
      data-reveal
      className={cx(styles.reveal)}
      style={{
        transitionDelay: card.delay,
        border: highlighted ? "1px solid rgba(255,193,7,0.3)" : "1px solid rgba(255,255,255,0.09)",
        borderRadius: 12,
        background: highlighted ? "linear-gradient(180deg, rgba(255,193,7,0.05), #111214)" : "#111214",
        padding: 22,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <span className={cx(styles.mono)} style={{ fontSize: 12, color: "#8a8a90", letterSpacing: "0.04em" }}>
          {card.id}
        </span>
        {card.badge && (
          <span
            className={cx(styles.pulseBadge)}
            style={{ display: "inline-flex", padding: "3px 9px", background: "#FFC107", color: "#0a0a0a", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", borderRadius: 5 }}
          >
            {card.badge}
          </span>
        )}
      </div>
      <p style={{ margin: "13px 0 0", fontSize: 15, fontWeight: 600, color: "#EDEDEC", lineHeight: 1.4 }}>{card.title}</p>
      <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
        <p style={{ margin: 0, fontSize: 11, letterSpacing: "0.13em", textTransform: "uppercase", color: "#6B6B70" }}>Төсөвт өртөг</p>
        <p className={cx(styles.mono)} style={{ margin: "4px 0 0", fontSize: "1.55rem", fontWeight: 700, color: "#FFC107" }}>
          {card.budget}
        </p>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 14 }}>
        <span style={{ fontSize: 12, color: "#A1A1AA", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 5, padding: "4px 9px" }}>{card.category}</span>
        <span className={cx(styles.mono)} style={{ fontSize: 12, color: card.countdownColor }}>
          {card.countdown}
        </span>
      </div>
    </div>
  );
}

function PricingCard({ tier }: { tier: PricingTier }) {
  const featured = tier.featured ?? false;
  return (
    <div
      data-reveal
      className={cx(styles.reveal)}
      style={{
        transitionDelay: tier.delay,
        position: featured ? "relative" : undefined,
        border: featured ? "1.5px solid #FFC107" : "1px solid rgba(255,255,255,0.1)",
        borderRadius: 14,
        background: featured ? "linear-gradient(180deg, rgba(255,193,7,0.08), #121212)" : "#111214",
        padding: featured ? "34px 28px" : "30px 26px",
        boxShadow: featured ? "0 28px 60px -26px rgba(255,193,7,0.4)" : undefined,
      }}
    >
      {featured && (
        <span
          style={{
            position: "absolute",
            top: -12,
            left: "50%",
            transform: "translateX(-50%)",
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "5px 14px",
            background: "#FFC107",
            color: "#0a0a0a",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.08em",
            borderRadius: 6,
            whiteSpace: "nowrap",
          }}
        >
          ⭐ ХАМГИЙН ИХ ХЭМНЭЛТ
        </span>
      )}
      <p style={{ margin: 0, fontSize: 13, letterSpacing: "0.14em", textTransform: "uppercase", color: tier.labelColor, fontWeight: featured ? 700 : 600 }}>{tier.label}</p>
      <p className={cx(styles.mono)} style={{ margin: "18px 0 0", fontSize: featured ? "2.6rem" : "2.3rem", fontWeight: 700, color: tier.priceColor, letterSpacing: "-0.02em" }}>
        {tier.price}
        <span style={{ fontFamily: "var(--font-sans)", fontSize: "0.95rem", fontWeight: 500, color: featured ? "#8a8a90" : "#71717A" }}>/сар</span>
      </p>
      {tier.note && <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "#3FBF6F", fontWeight: 500 }}>{tier.note}</p>}
      <a
        href={`/login?plan=${tier.plan}`}
        className={cx(featured ? styles.pricingFilledCta : styles.pricingOutlineCta)}
        style={{
          display: "block",
          textAlign: "center",
          marginTop: featured ? 20 : 22,
          padding: featured ? 14 : 13,
          background: featured ? "#FFC107" : "transparent",
          color: featured ? "#0a0a0a" : "#EDEDEC",
          fontWeight: 700,
          fontSize: featured ? 15 : 14.5,
          borderRadius: 8,
          textDecoration: "none",
          border: featured ? "1px solid #FFC107" : "1px solid rgba(255,255,255,0.2)",
          transition: featured ? "background-color .18s ease" : "all .18s ease",
        }}
      >
        Эхлэх
      </a>
      <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 13 }}>
        {tier.features.map((feature) => (
          <FeatureItem key={feature.text} text={feature.text} color={tier.featureColor} emphasis={feature.emphasis} />
        ))}
      </div>
    </div>
  );
}

export function HomePageClient({ botUsername }: { botUsername: string }) {
  const { status } = useSession();
  const [scrolled, setScrolled] = useState(false);
  const [activeTab, setActiveTab] = useState<"tender" | "gazar">("tender");
  const [countdown, setCountdown] = useState(HERO_COUNTDOWN_START);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY || document.documentElement.scrollTop || 0;
      setScrolled(y > 20);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const revealedClass = styles.revealed;
    if (!revealedClass) return;
    const elements = root.querySelectorAll<HTMLElement>("[data-reveal]");
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add(revealedClass);
            io.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" },
    );
    elements.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div ref={rootRef} style={{ background: "#0a0a0a", color: "#EDEDEC", minHeight: "100vh", width: "100%", overflowX: "hidden", position: "relative" }}>
      <nav
        id="mn-nav"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 100,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          padding: "13px clamp(20px, 5vw, 48px)",
          borderBottom: "1px solid",
          borderBottomColor: scrolled ? "rgba(255,255,255,0.08)" : "transparent",
          backgroundColor: scrolled ? "rgba(10,10,10,0.72)" : "transparent",
          backdropFilter: scrolled ? "blur(14px) saturate(140%)" : "none",
          WebkitBackdropFilter: scrolled ? "blur(14px) saturate(140%)" : "none",
          transition: "background-color .25s ease, border-color .25s ease",
        }}
      >
        <a href="#top" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
          <span
            className={cx(styles.mono)}
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, background: "#FFC107", color: "#0a0a0a", fontWeight: 700, fontSize: 19, borderRadius: 7 }}
          >
            ₮
          </span>
          <span style={{ color: "#F2F2F0", fontWeight: 700, fontSize: 16, letterSpacing: "-0.01em" }}>МН Платформ</span>
        </a>
        <a
          href="#telegram"
          className={cx(styles.navLoginBtn)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            padding: "9px 18px",
            background: "#FFC107",
            color: "#0a0a0a",
            fontWeight: 700,
            fontSize: 14,
            borderRadius: 7,
            textDecoration: "none",
            border: "1px solid #FFC107",
            transition: "background-color .18s ease",
          }}
        >
          Нэвтрэх
        </a>
      </nav>

      <header
        id="top"
        style={{
          position: "relative",
          padding: "clamp(104px, 16vh, 156px) clamp(20px, 5vw, 48px) clamp(52px, 8vh, 92px)",
          overflow: "hidden",
          background: "radial-gradient(900px 520px at 88% -10%, rgba(255,193,7,0.11), transparent 62%)",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "repeating-linear-gradient(rgba(255,255,255,0.02) 0 1px, transparent 1px 44px), repeating-linear-gradient(90deg, rgba(255,255,255,0.02) 0 1px, transparent 1px 44px)",
            pointerEvents: "none",
          }}
        />
        <div style={{ position: "relative", maxWidth: 1200, margin: "0 auto", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "clamp(36px, 5vw, 72px)" }}>
          <div style={{ flex: "1 1 430px", minWidth: 0 }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 12px",
                border: "1px solid rgba(255,193,7,0.3)",
                borderRadius: 999,
                background: "rgba(255,193,7,0.07)",
                marginBottom: 26,
              }}
            >
              <span className={cx(styles.blinkDot)} style={{ width: 7, height: 7, borderRadius: "50%", background: "#FFC107", display: "inline-block" }} />
              <span className={cx(styles.mono)} style={{ fontSize: 11.5, letterSpacing: "0.16em", color: "#FFD66B", textTransform: "uppercase" }}>
                Бодит цагийн мэдээллийн платформ
              </span>
            </div>
            <h1 style={{ margin: 0, fontSize: "clamp(2.3rem, 6.2vw, 4.4rem)", lineHeight: 1, fontWeight: 800, letterSpacing: "-0.035em", color: "#F6F6F4" }}>
              Монголын тендер.
              <br />
              Үл хөдлөх.
              <br />
              <span style={{ color: "#FFC107" }}>Нэг платформд.</span>
            </h1>
            <p style={{ margin: "24px 0 0", maxWidth: 480, fontSize: "clamp(1rem, 1.6vw, 1.18rem)", lineHeight: 1.55, color: "#A1A1AA" }}>
              8,000+ тендер, 9 дүүргийн үл хөдлөхийн үнэ — өдөр бүр шинэчлэгдэж, чухал бүхэн Telegram-аар шууд гар утсанд тань ирнэ.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 34 }}>
              <a
                href={status === "authenticated" ? "/dashboard" : "/login"}
                className={cx(styles.ctaPrimary)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "15px 26px",
                  background: "#FFC107",
                  color: "#0a0a0a",
                  fontWeight: 700,
                  fontSize: 15.5,
                  borderRadius: 8,
                  textDecoration: "none",
                  border: "1px solid #FFC107",
                  transition: "background-color .18s ease, transform .18s ease",
                }}
              >
                Эхлэх — үнэгүй туршина уу
              </a>
              <a
                href="#how"
                className={cx(styles.ctaOutline)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "15px 24px",
                  background: "transparent",
                  color: "#EDEDEC",
                  fontWeight: 600,
                  fontSize: 15.5,
                  borderRadius: 8,
                  textDecoration: "none",
                  border: "1px solid rgba(255,255,255,0.16)",
                  transition: "border-color .18s ease, background-color .18s ease",
                }}
              >
                Хэрхэн ажилладаг вэ ↓
              </a>
            </div>
            <p className={cx(styles.mono)} style={{ margin: "22px 0 0", fontSize: 12, letterSpacing: "0.04em", color: "#6B6B70" }}>
              // Картгүй эхлэх · Хүссэн үедээ цуцлах
            </p>
          </div>

          <div style={{ flex: "1 1 360px", minWidth: 0 }}>
            <div
              className={cx(styles.floatCard)}
              style={{
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 13,
                background: "linear-gradient(180deg, #141518, #0e0f11)",
                boxShadow: "0 32px 70px -28px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.02) inset",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "11px 15px",
                  borderBottom: "1px solid rgba(255,255,255,0.07)",
                  background: "rgba(255,255,255,0.015)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#3a3b3e" }} />
                  <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#3a3b3e" }} />
                  <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#3a3b3e" }} />
                  <span className={cx(styles.mono)} style={{ fontSize: 11, color: "#6B6B70", marginLeft: 6, letterSpacing: "0.06em" }}>
                    МН ПЛАТФОРМ
                  </span>
                </div>
                <span className={cx(styles.mono)} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 10.5, letterSpacing: "0.1em", color: "#3FBF6F" }}>
                  <span className={cx(styles.blinkDot)} style={{ width: 6, height: 6, borderRadius: "50%", background: "#3FBF6F", display: "inline-block" }} />
                  LIVE
                </span>
              </div>
              <div style={{ padding: 18 }}>
                <div style={{ border: "1px solid rgba(255,193,7,0.28)", borderRadius: 9, background: "rgba(255,193,7,0.04)", padding: 15, position: "relative" }}>
                  <span
                    className={cx(styles.mono, styles.pulseBadge)}
                    style={{ position: "absolute", top: 13, right: 13, display: "inline-flex", alignItems: "center", padding: "3px 9px", background: "#FFC107", color: "#0a0a0a", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", borderRadius: 5 }}
                  >
                    ШИНЭ
                  </span>
                  <p className={cx(styles.mono)} style={{ margin: 0, fontSize: 12, color: "#8a8a90", letterSpacing: "0.05em" }}>
                    TEND-2026-04812
                  </p>
                  <p style={{ margin: "7px 0 0", fontSize: 14.5, fontWeight: 600, color: "#EDEDEC", lineHeight: 1.35, maxWidth: "88%" }}>
                    Улаанбаатар хотын Захирагчийн ажлын алба
                  </p>
                  <div style={{ marginTop: 14, paddingTop: 13, borderTop: "1px solid rgba(255,255,255,0.07)" }}>
                    <p style={{ margin: 0, fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "#6B6B70" }}>Төсөвт өртөг</p>
                    <p className={cx(styles.mono)} style={{ margin: "4px 0 0", fontSize: "clamp(1.5rem, 4vw, 1.9rem)", fontWeight: 700, color: "#FFC107", letterSpacing: "-0.01em" }}>
                      ₮2,400,000,000
                    </p>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 13 }}>
                    <span style={{ fontSize: 12, color: "#A1A1AA", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 5, padding: "4px 9px" }}>Зам, гүүрийн барилга</span>
                    <span className={cx(styles.mono)} style={{ fontSize: 12.5, color: "#FF8A5E", letterSpacing: "0.02em" }}>
                      ⏳ {formatCountdown(countdown)}
                    </span>
                  </div>
                </div>
                <div style={{ marginTop: 16, display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 14 }}>
                  <div>
                    <p style={{ margin: 0, fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "#6B6B70" }}>Хан-Уул · м² үнэ</p>
                    <p className={cx(styles.mono)} style={{ margin: "5px 0 0", fontSize: 17, fontWeight: 700, color: "#EDEDEC" }}>
                      ₮4,210,000 <span style={{ fontSize: 12, color: "#3FBF6F", fontWeight: 500 }}>▲ 2.1%</span>
                    </p>
                  </div>
                  <svg viewBox="0 0 150 46" width="150" height="46" preserveAspectRatio="none" style={{ display: "block", flexShrink: 0 }}>
                    <polyline
                      className={cx(styles.drawLine)}
                      points="0,36 18,33 34,38 50,28 66,30 82,22 100,25 118,15 134,18 150,7"
                      fill="none"
                      stroke="#FFC107"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeDasharray="320"
                      strokeDashoffset="320"
                    ></polyline>
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <section style={{ borderTop: "1px solid rgba(255,255,255,0.08)", borderBottom: "1px solid rgba(255,255,255,0.08)", background: "#0c0d0f" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", flexWrap: "wrap" }}>
          {STATS.map((stat, index) => (
            <div
              key={stat.label}
              style={{
                flex: "1 1 200px",
                padding: "26px clamp(18px, 3vw, 32px)",
                borderRight: index < STATS.length - 1 ? "1px solid rgba(255,255,255,0.06)" : undefined,
              }}
            >
              <p className={cx(styles.mono)} style={{ margin: 0, fontSize: "clamp(1.6rem, 3vw, 2.1rem)", fontWeight: 700, color: "#FFC107", letterSpacing: "-0.01em" }}>
                {stat.value}
              </p>
              <p style={{ margin: "5px 0 0", fontSize: 13, color: "#A1A1AA", letterSpacing: "0.02em" }}>{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      <section style={{ padding: "clamp(64px, 9vh, 112px) clamp(20px, 5vw, 48px)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div data-reveal className={cx(styles.reveal)}>
            <p className={cx(styles.mono)} style={sectionLabelStyle}>
              // Асуудал
            </p>
            <h2 style={{ ...sectionHeadingStyle, maxWidth: 620 }}>Мэдээлэлгүй бол хожигдоно.</h2>
          </div>
          <div style={{ marginTop: 42, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))", gap: 18 }}>
            <div data-reveal className={cx(styles.reveal)} style={{ transitionDelay: "0.05s", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 12, background: "#111214", padding: "clamp(22px, 3vw, 32px)" }}>
              <span className={cx(styles.mono)} style={{ display: "inline-flex", fontSize: 11, letterSpacing: "0.14em", color: "#FFD66B", border: "1px solid rgba(255,193,7,0.3)", borderRadius: 5, padding: "4px 9px" }}>
                ТЕНДЕР
              </span>
              <h3 style={{ margin: "18px 0 0", fontSize: "clamp(1.25rem, 2.4vw, 1.6rem)", fontWeight: 700, letterSpacing: "-0.02em", color: "#F2F2F0", lineHeight: 1.2 }}>Тендер хаана байна вэ?</h3>
              <p style={{ margin: "14px 0 0", fontSize: 15, lineHeight: 1.6, color: "#A1A1AA" }}>
                Өдөр бүр 20+ сайт гар аргаар шалгах уу? Чухал тендерийг дуусаад л олж мэдэх үү? Боломж чимээгүйхэн гараас алдагдсаар.
              </p>
              <div style={{ marginTop: 20, display: "flex", alignItems: "center", gap: 10, paddingTop: 18, borderTop: "1px solid rgba(255,255,255,0.07)" }}>
                <span className={cx(styles.mono)} style={{ fontSize: "1.5rem", fontWeight: 700, color: "#FF6B5E" }}>
                  20+
                </span>
                <span style={{ fontSize: 13, color: "#71717A", lineHeight: 1.4 }}>
                  сайт өдөр бүр
                  <br />
                  гараар шалгана
                </span>
              </div>
            </div>
            <div data-reveal className={cx(styles.reveal)} style={{ transitionDelay: "0.12s", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 12, background: "#111214", padding: "clamp(22px, 3vw, 32px)" }}>
              <span className={cx(styles.mono)} style={{ display: "inline-flex", fontSize: 11, letterSpacing: "0.14em", color: "#FFD66B", border: "1px solid rgba(255,193,7,0.3)", borderRadius: 5, padding: "4px 9px" }}>
                ҮЛ ХӨДЛӨХ
              </span>
              <h3 style={{ margin: "18px 0 0", fontSize: "clamp(1.25rem, 2.4vw, 1.6rem)", fontWeight: 700, letterSpacing: "-0.02em", color: "#F2F2F0", lineHeight: 1.2 }}>Байрны үнэ өсөв үү, буурав уу?</h3>
              <p style={{ margin: "14px 0 0", fontSize: 15, lineHeight: 1.6, color: "#A1A1AA" }}>
                Хэн мэдэх вэ? Зуучлагчийн хэлсэн тоонд итгэх үү? Бодит м² үнэ хаана байгааг таамаглахаа болих цаг болсон.
              </p>
              <div style={{ marginTop: 20, display: "flex", alignItems: "center", gap: 10, paddingTop: 18, borderTop: "1px solid rgba(255,255,255,0.07)" }}>
                <span className={cx(styles.mono)} style={{ fontSize: "1.5rem", fontWeight: 700, color: "#FF6B5E" }}>
                  ?
                </span>
                <span style={{ fontSize: 13, color: "#71717A", lineHeight: 1.4 }}>
                  бодит үнэ
                  <br />
                  хаана ч ил биш
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        id="how"
        style={{
          padding: "clamp(64px, 9vh, 112px) clamp(20px, 5vw, 48px)",
          scrollMarginTop: 80,
          background: "#0c0d0f",
          borderTop: "1px solid rgba(255,255,255,0.08)",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div data-reveal className={cx(styles.reveal)} style={{ textAlign: "center" }}>
            <p className={cx(styles.mono)} style={sectionLabelStyle}>
              // Хэрхэн ажилладаг вэ
            </p>
            <h2 style={sectionHeadingStyle}>3 алхамд эхэл.</h2>
            <div style={{ display: "inline-flex", marginTop: 28, padding: 4, background: "#141518", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 9, gap: 4 }}>
              <button
                type="button"
                onClick={() => setActiveTab("tender")}
                style={{
                  appearance: "none",
                  cursor: "pointer",
                  border: "none",
                  padding: "10px 24px",
                  borderRadius: 6,
                  fontSize: 14.5,
                  fontWeight: activeTab === "tender" ? 700 : 500,
                  color: activeTab === "tender" ? "#0a0a0a" : "#A1A1AA",
                  background: activeTab === "tender" ? "#FFC107" : "transparent",
                  transition: "all .18s ease",
                }}
              >
                Тендер
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("gazar")}
                style={{
                  appearance: "none",
                  cursor: "pointer",
                  border: "none",
                  padding: "10px 24px",
                  borderRadius: 6,
                  fontSize: 14.5,
                  fontWeight: activeTab === "gazar" ? 700 : 500,
                  color: activeTab === "gazar" ? "#0a0a0a" : "#A1A1AA",
                  background: activeTab === "gazar" ? "#FFC107" : "transparent",
                  transition: "all .18s ease",
                }}
              >
                Үл хөдлөх
              </button>
            </div>
          </div>

          <div
            id="panel-tender"
            data-reveal
            className={cx(styles.reveal)}
            style={{ marginTop: 42, display: activeTab === "tender" ? "grid" : "none", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))", gap: 16 }}
          >
            {HOW_STEPS.tender.map((step) => (
              <StepCard key={step.title} step={step} />
            ))}
          </div>

          <div
            id="panel-gazar"
            style={{ marginTop: 42, display: activeTab === "gazar" ? "grid" : "none", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))", gap: 16 }}
          >
            {HOW_STEPS.gazar.map((step) => (
              <StepCard key={step.title} step={step} />
            ))}
          </div>
        </div>
      </section>

      <section id="data" style={{ padding: "clamp(64px, 9vh, 112px) clamp(20px, 5vw, 48px)", scrollMarginTop: 80 }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div data-reveal className={cx(styles.reveal)} style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
            <div>
              <p className={cx(styles.mono)} style={sectionLabelStyle}>
                // Яг одоо
              </p>
              <h2 style={sectionHeadingStyle}>Платформ дээр одоо.</h2>
            </div>
            <span className={cx(styles.mono)} style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, letterSpacing: "0.08em", color: "#3FBF6F" }}>
              <span className={cx(styles.blinkDot)} style={{ width: 7, height: 7, borderRadius: "50%", background: "#3FBF6F", display: "inline-block" }} />
              Бодит цагт шинэчлэгдэж байна
            </span>
          </div>
          <div style={{ marginTop: 34, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 290px), 1fr))", gap: 16 }}>
            {DATA_CARDS.map((card) => (
              <DataCard key={card.id} card={card} />
            ))}
          </div>
        </div>
      </section>

      <section
        id="pricing"
        style={{
          padding: "clamp(64px, 9vh, 112px) clamp(20px, 5vw, 48px)",
          scrollMarginTop: 80,
          background: "#0c0d0f",
          borderTop: "1px solid rgba(255,255,255,0.08)",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <div style={{ maxWidth: 1150, margin: "0 auto" }}>
          <div data-reveal className={cx(styles.reveal)} style={{ textAlign: "center" }}>
            <p className={cx(styles.mono)} style={sectionLabelStyle}>
              // Үнэ
            </p>
            <h2 style={sectionHeadingStyle}>Энгийн, ил тод үнэ.</h2>
            <p style={{ margin: "14px 0 0", fontSize: 15, color: "#A1A1AA" }}>НӨАТ багтсан · Хүссэн үедээ цуцлах · Картгүй эхлэх</p>
          </div>
          <div style={{ marginTop: 44, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap: 18, alignItems: "start" }}>
            {PRICING_TIERS.map((tier) => (
              <PricingCard key={tier.label} tier={tier} />
            ))}
          </div>
        </div>
      </section>

      <section
        id="telegram"
        style={{
          position: "relative",
          padding: "clamp(70px, 11vh, 128px) clamp(20px, 5vw, 48px)",
          scrollMarginTop: 80,
          overflow: "hidden",
          background: "radial-gradient(680px 420px at 50% 0%, rgba(34,158,217,0.14), transparent 65%)",
        }}
      >
        <div data-reveal className={cx(styles.reveal)} style={{ maxWidth: 560, margin: "0 auto", textAlign: "center" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 58,
              height: 58,
              borderRadius: 14,
              background: "#229ED9",
              marginBottom: 24,
              boxShadow: "0 16px 40px -12px rgba(34,158,217,0.6)",
            }}
          >
            <svg width="30" height="30" viewBox="0 0 24 24" fill="#fff">
              <path d="M21.94 4.5 18.6 20.3c-.25 1.1-.9 1.38-1.83.86l-5.06-3.73-2.44 2.35c-.27.27-.5.5-1.02.5l.36-5.14L17.97 6.4c.4-.36-.09-.56-.62-.2L6.81 13.04 1.82 11.5c-1.08-.34-1.1-1.08.23-1.6L20.5 2.9c.9-.34 1.7.2 1.44 1.6z"></path>
            </svg>
          </div>
          <h2 style={{ margin: 0, fontSize: "clamp(1.8rem, 4.2vw, 2.8rem)", fontWeight: 800, letterSpacing: "-0.03em", color: "#F6F6F4", lineHeight: 1.05 }}>
            Telegram-ээр 1 товшилтоор
            <br />
            нэвтэрнэ.
          </h2>
          <p style={{ margin: "18px auto 0", maxWidth: 420, fontSize: 16, lineHeight: 1.55, color: "#A1A1AA" }}>Бүртгэл, баталгаажуулалт, нууц үг — нэг ч алхам шаардахгүй.</p>
          <div style={{ marginTop: 30, display: "flex", justifyContent: "center" }}>
            <TelegramLoginButton botUsername={botUsername} />
          </div>
          <p className={cx(styles.mono)} style={{ margin: "16px 0 0", fontSize: 12, letterSpacing: "0.04em", color: "#6B6B70" }}>
            // Бид зөвхөн нэр, профайл зургийг л авна
          </p>
        </div>
      </section>

      <footer style={{ borderTop: "1px solid rgba(255,255,255,0.08)", padding: "38px clamp(20px, 5vw, 48px)", background: "#0a0a0a" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <span
              className={cx(styles.mono)}
              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, background: "#FFC107", color: "#0a0a0a", fontWeight: 700, fontSize: 17, borderRadius: 7 }}
            >
              ₮
            </span>
            <span style={{ color: "#A1A1AA", fontSize: 14 }}>
              МН Платформ <span style={{ color: "#6B6B70" }}>© 2026</span>
            </span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 22 }}>
            <a href="#" className={cx(styles.footerLink)} style={{ color: "#A1A1AA", fontSize: 14, textDecoration: "none", transition: "color .18s ease" }}>
              Үйлчилгээний нөхцөл
            </a>
            <a href="#" className={cx(styles.footerLink)} style={{ color: "#A1A1AA", fontSize: 14, textDecoration: "none", transition: "color .18s ease" }}>
              Нууцлал
            </a>
            <a href="#" className={cx(styles.footerLink)} style={{ color: "#A1A1AA", fontSize: 14, textDecoration: "none", transition: "color .18s ease" }}>
              Холбоо барих
            </a>
            <a href="#telegram" className={cx(styles.footerLink)} style={{ color: "#A1A1AA", fontSize: 14, textDecoration: "none", transition: "color .18s ease" }}>
              Telegram
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
