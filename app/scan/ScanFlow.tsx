"use client";

// Scan a buku 555 page or a receipt, Shopee "Scan & Pay" style: full-screen camera,
// a short "reading" wait, then a check screen where the owner fixes lines and saves them.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { DebtStoreError, newDebtId } from "@/lib/debt-store";
import { formatSen, MAX_ITEM_LENGTH, MAX_NAME_LENGTH, todayLocal, type DebtErrors } from "@/lib/debts";
import type { T } from "@/lib/i18n";
import {
  customerNames,
  includedTotalSen,
  isNewCustomer,
  linesToDebts,
  parseScanDraft,
  sampleRead,
  type ScanLine,
  type ScanMode,
  scanDraftKey,
} from "@/lib/scan";
import { BackIcon, BoltIcon, CheckIcon, CloseIcon, ImageIcon, NoteIcon, ReceiptIcon } from "../components/icons";
import { useDialog } from "../components/useDialog";
import { useDebts } from "../useDebts";
import { useT } from "../useT";

type Phase = "camera" | "reading" | "check";

function readingSteps(mode: ScanMode, t: T): string[] {
  const found = sampleRead(mode, todayLocal(), t).length;
  return [
    t("scan.step.clear"),
    t("scan.step.found", { count: found }),
    mode === "notebook" ? t("scan.step.matching") : t("scan.step.readingItems"),
    t("scan.step.ready"),
  ];
}
const STEP_MS = 650;

/** Drops a saved check-screen draft, so a new photo or a retake starts from a fresh read. */
function clearDraft(mode: ScanMode) {
  try {
    sessionStorage.removeItem(scanDraftKey(mode));
  } catch {}
}

/** Moves focus to a screen's heading when it appears, so screen readers announce the new screen. */
function useFocusOnMount<T extends HTMLElement>(enabled = true) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (enabled) ref.current?.focus();
  }, [enabled]);
  return ref;
}

export default function ScanFlow() {
  const [phase, setPhase] = useState<Phase>("camera");
  const [mode, setMode] = useState<ScanMode>("notebook");
  const [photo, setPhoto] = useState<string | null>(null);

  // Object URLs from the gallery hold memory until revoked.
  useEffect(() => {
    return () => {
      if (photo?.startsWith("blob:")) URL.revokeObjectURL(photo);
    };
  }, [photo]);

  function onPhoto(url: string) {
    clearDraft(mode);
    setPhoto(url);
    setPhase("reading");
  }
  const onRead = useCallback(() => setPhase("check"), []);
  // On first load the page itself has focus; only move it when coming back from Retake.
  const [returned, setReturned] = useState(false);

  if (phase === "camera") return <Camera mode={mode} onMode={setMode} onPhoto={onPhoto} focusTitle={returned} />;
  if (phase === "reading") return <Reading mode={mode} photo={photo} onDone={onRead} />;
  return (
    <Check
      mode={mode}
      photo={photo}
      onRetake={() => {
        clearDraft(mode);
        setReturned(true);
        setPhase("camera");
      }}
    />
  );
}

/* 1 · Camera */

type CameraState = "starting" | "live" | "unavailable";

function Camera({
  mode,
  onMode,
  onPhoto,
  focusTitle,
}: {
  mode: ScanMode;
  onMode: (m: ScanMode) => void;
  onPhoto: (url: string) => void;
  focusTitle: boolean;
}) {
  const { t } = useT();
  const titleRef = useFocusOnMount<HTMLHeadingElement>(focusTitle);
  // True once the video has a frame to capture; the shutter waits for it.
  const [videoReady, setVideoReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const takeRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<CameraState>("starting");
  const [torch, setTorch] = useState<{ supported: boolean; on: boolean }>({ supported: false, on: false });

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!navigator.mediaDevices?.getUserMedia) {
      setState("unavailable");
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => {});
        }
        const track = stream.getVideoTracks()[0];
        // Camera taken by another app or unplugged: offer the photo options instead.
        if (track) track.onended = () => setState("unavailable");
        const caps = (track?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean };
        setTorch({ supported: Boolean(caps.torch), on: false });
        setState("live");
      })
      .catch(() => {
        if (!cancelled) setState("unavailable");
      });
    return () => {
      cancelled = true;
      stop();
    };
  }, [stop]);

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const on = !torch.on;
    try {
      await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
      setTorch({ supported: true, on });
    } catch {
      setTorch({ supported: false, on: false });
    }
  }

  function snap() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    // Enough detail to read handwriting, small enough to keep in memory.
    const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    stop();
    onPhoto(canvas.toDataURL("image/jpeg", 0.85));
  }

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    stop();
    onPhoto(URL.createObjectURL(file));
  }

  return (
    <div className="scan-camera">
      {state === "live" ? (
        <video
          ref={videoRef}
          className="scan-video"
          playsInline
          muted
          aria-label={t("scan.cameraView")}
          onLoadedData={() => setVideoReady(true)}
        />
      ) : (
        <video ref={videoRef} className="scan-video" playsInline muted hidden />
      )}

      <div className="scan-camtop">
        <Link href="/" className="scan-round" aria-label={t("scan.close")}>
          <CloseIcon />
        </Link>
        <h1 ref={titleRef} tabIndex={-1}>
          {t("scan.title")}
        </h1>
        {torch.supported ? (
          <button
            type="button"
            className="scan-round"
            aria-pressed={torch.on}
            aria-label={torch.on ? t("scan.flashOff") : t("scan.flashOn")}
            onClick={toggleTorch}
          >
            <BoltIcon />
          </button>
        ) : (
          <span className="scan-round scan-round-empty" aria-hidden="true" />
        )}
      </div>

      {state === "live" && (
        <>
          <div className="scan-frame" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <span className="scan-line" />
          </div>
          <p className="scan-tip">
            {mode === "notebook" ? t("scan.tipNotebook") : t("scan.tipReceipt")}
          </p>
        </>
      )}

      {(state === "starting" || (state === "live" && !videoReady)) && (
        <p className="scan-tip scan-tip-mid" role="status">
          {t("scan.starting")}
        </p>
      )}

      {state === "unavailable" && (
        <div className="scan-fallback">
          <p className="scan-fallback-title">{t("scan.noCamera")}</p>
          <p>{t("scan.noCameraBody")}</p>
          <button type="button" className="button button-primary" onClick={() => takeRef.current?.click()}>
            {t("scan.takePhoto")}
          </button>
          <button type="button" className="button scan-fallback-alt" onClick={() => galleryRef.current?.click()}>
            {t("scan.chooseGallery")}
          </button>
        </div>
      )}

      <div className="scan-camfoot">
        <div className="scan-mode" role="group" aria-label={t("scan.modeGroup")}>
          <button type="button" aria-pressed={mode === "notebook"} onClick={() => onMode("notebook")}>
            <NoteIcon />
            {t("scan.notebook")}
          </button>
          <button type="button" aria-pressed={mode === "receipt"} onClick={() => onMode("receipt")}>
            <ReceiptIcon />
            {t("scan.receipt")}
          </button>
        </div>
        <div className="scan-controls">
          <button type="button" className="scan-gallery" onClick={() => galleryRef.current?.click()}>
            <span aria-hidden="true">
              <ImageIcon />
            </span>
            {t("scan.gallery")}
          </button>
          {state === "live" && videoReady ? (
            <button type="button" className="scan-shutter" aria-label={t("scan.shutter")} onClick={snap}>
              <b />
            </button>
          ) : (
            // Starting up: a dimmed shutter. No camera at all: no shutter (the buttons above take
            // or choose a photo instead); the space stays so Gallery doesn't jump.
            <span className={`scan-shutter scan-shutter-off${state === "unavailable" ? " scan-hidden" : ""}`} aria-hidden="true">
              <b />
            </span>
          )}
          <span className="scan-gallery scan-hidden" aria-hidden="true" />
        </div>
      </div>

      <input ref={galleryRef} type="file" accept="image/*" hidden onChange={onFile} />
      <input ref={takeRef} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
    </div>
  );
}

/* 2 · Reading */

function Reading({ mode, photo, onDone }: { mode: ScanMode; photo: string | null; onDone: () => void }) {
  const { t } = useT();
  const [step, setStep] = useState(0);
  const [steps] = useState(() => readingSteps(mode, t));
  const titleRef = useFocusOnMount<HTMLHeadingElement>();
  useEffect(() => {
    if (step >= steps.length) {
      onDone();
      return;
    }
    const timer = setTimeout(() => setStep((s) => s + 1), STEP_MS);
    return () => clearTimeout(timer);
  }, [step, steps.length, onDone]);

  const pct = Math.round((Math.min(step, steps.length) / steps.length) * 100);
  return (
    <div className="scan-camera">
      {photo && (
        // eslint-disable-next-line @next/next/no-img-element -- a local photo, not a site image
        <img src={photo} alt="" className="scan-video scan-photo-dim" />
      )}
      <div className="scan-sheet" role="status" aria-live="polite">
        <h1 ref={titleRef} tabIndex={-1}>
          {mode === "notebook" ? t("scan.readingBuku") : t("scan.readingReceipt")}
        </h1>
        <p>{t("scan.fewSeconds")}</p>
        <div className="scan-bar" role="progressbar" aria-label={t("scan.progress")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <b style={{ width: `${pct}%` }} />
        </div>
        <ul className="scan-steps">
          {steps.map((label, i) => (
            <li key={label} className={i < step ? "done" : i === step ? "now" : "later"}>
              <span aria-hidden="true">{i < step ? <CheckIcon /> : i === step ? "⋯" : ""}</span>
              {label}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* 3 · Check */

const NEW_NAME = "__new__";

function PhotoModal({
  photo,
  alt,
  onClose,
}: {
  photo: string;
  alt: string;
  onClose: () => void;
}) {
  const { t, formatNumber } = useT();
  const [zoom, setZoom] = useState(1);
  const ref = useDialog<HTMLDivElement>(onClose);
  // Zoom changes the photo's real size (not a CSS transform), so a zoomed photo makes the box
  // scroll and every edge, top included, can be reached.
  const bodyRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const measure = () => {
      const style = getComputedStyle(el);
      const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      setBox({ w: el.clientWidth - padX, h: el.clientHeight - padY });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const fit = box && natural ? Math.min(box.w / natural.w, box.h / natural.h, 1) : null;
  const size = fit && natural ? { width: natural.w * fit * zoom, height: natural.h * fit * zoom } : undefined;
  return (
    <div className="sheet-layer">
      <div className="sheet-dim" onClick={onClose} aria-hidden="true" />
      <div className="scan-photo-modal" ref={ref} role="dialog" aria-modal="true" aria-labelledby="scan-photo-title">
        <h2 id="scan-photo-title" className="visually-hidden">
          {alt}
        </h2>
        <div className="scan-photo-modal-header">
          <div className="scan-photo-modal-controls">
            <button
              type="button"
              className="button button-sm"
              onClick={() => setZoom((z) => Math.max(0.75, z - 0.25))}
              aria-label={t("scanx.viewer.zoomOut")}
            >
              −
            </button>
            <span className="scan-photo-zoom">{t("scanx.viewer.zoom", { percent: formatNumber(Math.round(zoom * 100)) })}</span>
            <button
              type="button"
              className="button button-sm"
              onClick={() => setZoom((z) => Math.min(3, z + 0.25))}
              aria-label={t("scanx.viewer.zoomIn")}
            >
              +
            </button>
            <button type="button" className="button button-sm" aria-label={t("scanx.viewer.resetLabel")} onClick={() => setZoom(1)}>
              {t("scanx.viewer.reset")}
            </button>
          </div>
          <button type="button" className="sheet-close" aria-label={t("common.close")} onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <div className="scan-photo-modal-body" ref={bodyRef}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a local photo, not a site image */}
          <img
            src={photo}
            alt={alt}
            className={size ? "scan-photo-sized" : undefined}
            style={size}
            onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth || 1, h: e.currentTarget.naturalHeight || 1 })}
          />
        </div>
      </div>
    </div>
  );
}

function Check({ mode, photo, onRetake }: { mode: ScanMode; photo: string | null; onRetake: () => void }) {
  const { t, formatDay } = useT();
  const router = useRouter();
  const { debts, ready, addMany } = useDebts();
  const titleRef = useFocusOnMount<HTMLHeadingElement>();
  // After a refused save: the line whose first bad field gets focus once it's open.
  const [focusLine, setFocusLine] = useState<{ key: string; n: number } | null>(null);
  const [today] = useState(() => todayLocal());
  const draftKey = scanDraftKey(mode);
  const [lines, setLines] = useState<ScanLine[]>(() => {
    let saved: ScanLine[] | null = null;
    if (typeof window !== "undefined") {
      try {
        // A draft in the wrong shape (old or tampered) is ignored, not trusted.
        saved = parseScanDraft(sessionStorage.getItem(draftKey));
      } catch {}
    }
    return saved ?? sampleRead(mode, todayLocal(), t);
  });
  const [open, setOpen] = useState<string | null>(mode === "receipt" ? "r1" : null);
  const [errors, setErrors] = useState<Record<string, DebtErrors>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pickNew, setPickNew] = useState(false);
  const [viewPhoto, setViewPhoto] = useState(false);

  // Persist draft in sessionStorage so owner edits survive navigation/failures
  useEffect(() => {
    try {
      sessionStorage.setItem(draftKey, JSON.stringify(lines));
    } catch {}
  }, [lines, draftKey]);

  const known = customerNames(debts);
  const included = lines.filter((l) => l.include);
  const total = includedTotalSen(lines, today);
  // Lines still showing an error; the notice goes away as they're fixed or unticked.
  const problemCount = lines.filter((l) => l.include && Object.values(errors[l.key] ?? {}).some(Boolean)).length;

  // Editing a line clears its "unsure" flag (the owner has looked at it) and that field's error only.
  function update(key: string, field: "customerName" | "item" | "amount", value: string) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, [field]: value, unsure: undefined } : l)));
    if (errors[key]?.[field]) setErrors((prev) => ({ ...prev, [key]: { ...prev[key], [field]: undefined } }));
  }

  useEffect(() => {
    if (!focusLine) return;
    const lineErrors = errors[focusLine.key] ?? {};
    const field = (["customerName", "item", "amount"] as const).find((name) => lineErrors[name]);
    const id =
      mode === "receipt" && field === "customerName"
        ? "scan-customer"
        : `${focusLine.key}-${field === "customerName" ? "name" : field ?? "amount"}`;
    document.getElementById(id)?.focus();
    // Runs once per refused save; errors are read as they were then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusLine]);

  function toggle(key: string, include: boolean) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, include } : l)));
    if (!include && errors[key]) setErrors((prev) => ({ ...prev, [key]: {} }));
  }

  function save() {
    setSaveError(null);
    const now = todayLocal();
    const result = linesToDebts(lines, now, { newId: newDebtId, now: new Date() }, t);
    if (!result.ok) {
      setErrors(Object.fromEntries(result.problems.map((p) => [p.key, p.errors])));
      setOpen(result.problems[0].key);
      setFocusLine((prev) => ({ key: result.problems[0].key, n: (prev?.n ?? 0) + 1 }));
      return;
    }
    setSaving(true);
    try {
      addMany(result.debts); // one write: all of them or none
      try {
        sessionStorage.removeItem(draftKey);
      } catch {}
    } catch (error) {
      setSaveError(error instanceof DebtStoreError ? error.message : t("add.saveFailed"));
      setSaving(false);
      return;
    }
    router.push(`/ledger?scanned=${result.debts.length}`);
  }

  const receipt = mode === "receipt" ? lines[0] : null;

  return (
    <div className="tab-page">
      <div className="tab-top">
        <button type="button" className="tab-back" aria-label={t("scan.backToCamera")} onClick={onRetake}>
          <BackIcon />
        </button>
        <h1 ref={titleRef} tabIndex={-1}>
          {mode === "notebook" ? t("scan.checkPage") : t("scan.checkReceipt")}
        </h1>
        <span className="tab-back" aria-hidden="true" />
      </div>

      <section className="card scan-thumb">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element -- a local photo, not a site image
          <img src={photo} alt={mode === "notebook" ? t("scan.photoNotebook") : t("scan.photoReceipt")} />
        ) : (
          <span className="scan-thumb-empty" aria-hidden="true" />
        )}
        <div className="scan-thumb-text">
          <p className="tab-name">{mode === "notebook" ? t("scan.notebookPage") : t("scan.receipt")}</p>
          <p className="tab-item">
            {formatDay(today, { year: false })} · {t("scan.linesFound", { count: lines.length })}
          </p>
        </div>
        <div className="scan-thumb-actions">
          {photo && (
            <button type="button" className="button button-sm scan-view-photo" onClick={() => setViewPhoto(true)}>
              {t("scanx.viewPhoto")}
            </button>
          )}
          <button type="button" className="link-button scan-retake" onClick={onRetake}>
            {t("scan.retake")}
          </button>
        </div>
      </section>

      {viewPhoto && photo && (
        <PhotoModal
          photo={photo}
          alt={mode === "notebook" ? t("scan.photoNotebook") : t("scan.photoReceipt")}
          onClose={() => setViewPhoto(false)}
        />
      )}

      <p className="notice notice-warning scan-sample" role="note">
        {t("scan.sample")}
      </p>

      {problemCount > 0 && (
        <p className="notice notice-error" role="alert">
          {t("scan.linesNeedFixing", { count: problemCount })}
        </p>
      )}

      {saveError && (
        <div className="notice notice-error" role="alert">
          <p className="notice-text">{saveError}</p>
          <div className="notice-actions">
            <button type="button" className="button" onClick={save} disabled={saving}>
              {t("scanx.retrySave")}
            </button>
            <button type="button" className="button" onClick={onRetake}>
              {t("scan.retake")}
            </button>
          </div>
        </div>
      )}

      <div className={`scan-check-split${photo ? " scan-check-split-photo" : ""}`}>
        {photo && (
          <div className="scan-photo-inspect">
            <p className="scan-photo-inspect-title">{t("scanx.original")}</p>
            {/* eslint-disable-next-line @next/next/no-img-element -- a local photo, not a site image */}
            <img src={photo} alt={mode === "notebook" ? t("scan.photoNotebook") : t("scan.photoReceipt")} />
            <button type="button" className="link-button scan-photo-expand" onClick={() => setViewPhoto(true)}>
              {t("scanx.expandPhoto")}
            </button>
          </div>
        )}

        <div className="scan-check-main">
          {receipt && (
            <section className="card scan-who">
              <label htmlFor="scan-customer">{t("scan.whichCustomer")}</label>
              <select
                id="scan-customer"
                value={pickNew ? NEW_NAME : receipt.customerName}
                aria-invalid={Boolean(errors[receipt.key]?.customerName) || undefined}
                aria-describedby={errors[receipt.key]?.customerName ? "scan-customer-error" : undefined}
                onChange={(e) => {
                  if (e.target.value === NEW_NAME) {
                    setPickNew(true);
                    update(receipt.key, "customerName", "");
                  } else {
                    setPickNew(false);
                    update(receipt.key, "customerName", e.target.value);
                  }
                }}
              >
                <option value="" disabled>
                  {ready ? t("scan.pickCustomer") : t("scan.loadingCustomers")}
                </option>
                {known.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
                <option value={NEW_NAME}>{t("scan.newCustomerOption")}</option>
              </select>
              {pickNew && (
                <input
                  type="text"
                  aria-label={t("scan.newCustomerName")}
                  placeholder={t("scan.customerPlaceholder")}
                  maxLength={MAX_NAME_LENGTH}
                  value={receipt.customerName}
                  aria-invalid={Boolean(errors[receipt.key]?.customerName) || undefined}
                  aria-describedby={errors[receipt.key]?.customerName ? "scan-customer-error" : undefined}
                  onChange={(e) => update(receipt.key, "customerName", e.target.value)}
                />
              )}
              {errors[receipt.key]?.customerName && (
                <p className="field-error" id="scan-customer-error">
                  {t("scan.pickWho")}
                </p>
              )}
            </section>
          )}

          <p className="bill-meta">
            <span>
              {t("scan.lines", { count: lines.length })} · {t("scan.ticked", { count: included.length })}
            </span>
            <span>RM {formatSen(total)}</span>
          </p>

          <ul className="tab-list scan-lines">
            {lines.map((l) => {
              const lineErrors = errors[l.key] ?? {};
              const hasError = Object.values(lineErrors).some(Boolean);
              const isOpen = open === l.key;
              const fresh = mode === "notebook" && ready && isNewCustomer(l.customerName, known);
              return (
                <li key={l.key} className={`scan-row${hasError ? " scan-row-error" : ""}`}>
                  <div className="scan-row-main">
                    <input
                      type="checkbox"
                      checked={l.include}
                      onChange={(e) => toggle(l.key, e.target.checked)}
                      aria-label={t("scan.addLine", { name: l.customerName || t("scan.thisLine"), amount: l.amount || t("scan.noAmount") })}
                    />
                    <button
                      type="button"
                      className="scan-row-open"
                      aria-expanded={isOpen}
                      aria-controls={`scan-edit-${l.key}`}
                      onClick={() => setOpen(isOpen ? null : l.key)}
                    >
                      <span className="tab-who">
                        <span className="tab-name">{l.customerName || (mode === "receipt" ? t("scan.pickAbove") : t("scan.noName"))}</span>
                        <span className="tab-item">{l.item || t("scan.noItem")}</span>
                        {fresh && <span className="badge badge-sent badge-text">{t("scan.newCustomer")}</span>}
                        {hasError && <span className="badge badge-overdue badge-text">{t("scan.needsFixing")}</span>}
                      </span>
                      <span className="tab-amt">RM {l.amount || "—"}</span>
                    </button>
                  </div>

                  {l.unsure && (
                    <div className="scan-unsure-banner">
                      <span>{l.unsure}</span>
                      <button
                        type="button"
                        className="link-button"
                        aria-label={t("scanx.fixAmountLabel", { name: l.customerName || t("scan.thisLine") })}
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpen(l.key);
                          setTimeout(() => {
                            document.getElementById(`${l.key}-amount`)?.focus();
                          }, 50);
                        }}
                      >
                        {t("scanx.fixAmount")}
                      </button>
                    </div>
                  )}

                  {isOpen && (
                    <div className="scan-edit" id={`scan-edit-${l.key}`}>
                      {mode === "notebook" && (
                        <EditField
                          id={`${l.key}-name`}
                          label={t("scan.customer")}
                          value={l.customerName}
                          max={MAX_NAME_LENGTH}
                          error={lineErrors.customerName}
                          onChange={(v) => update(l.key, "customerName", v)}
                        />
                      )}
                      <EditField
                        id={`${l.key}-item`}
                        label={t("add.item")}
                        value={l.item}
                        max={MAX_ITEM_LENGTH}
                        error={lineErrors.item}
                        onChange={(v) => update(l.key, "item", v)}
                      />
                      <EditField
                        id={`${l.key}-amount`}
                        label={t("add.amount")}
                        value={l.amount}
                        inputMode="decimal"
                        error={lineErrors.amount}
                        onChange={(v) => update(l.key, "amount", v)}
                      />
                      {lineErrors.date && (
                        <p className="field-error" id={`${l.key}-date-error`}>
                          {lineErrors.date}
                        </p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <button
            type="button"
            className="button button-primary tab-pay"
            disabled={!ready || saving || included.length === 0}
            onClick={save}
          >
            {included.length === 0 ? t("scan.tickOne") : t("scan.addToLedger", { count: included.length })}
          </button>
          <p className="tab-note">{t("scan.nothingSent")}</p>
        </div>
      </div>
    </div>
  );
}

function EditField({
  id,
  label,
  value,
  max,
  error,
  inputMode,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  max?: number;
  error?: string;
  inputMode?: "decimal";
  onChange: (value: string) => void;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        value={value}
        maxLength={max}
        inputMode={inputMode}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}
