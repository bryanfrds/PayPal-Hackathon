"use client";

// Scan a buku 555 page or a receipt, Shopee "Scan & Pay" style: full-screen camera,
// a short "reading" wait, then a check screen where the owner fixes lines and saves them.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { DebtStoreError, newDebtId } from "@/lib/debt-store";
import { formatSen, MAX_ITEM_LENGTH, MAX_NAME_LENGTH, todayLocal, type DebtErrors } from "@/lib/debts";
import { formatDay } from "@/lib/customer-tab";
import {
  customerNames,
  includedTotalSen,
  isNewCustomer,
  linesToDebts,
  sampleRead,
  type ScanLine,
  type ScanMode,
} from "@/lib/scan";
import { useDebts } from "../useDebts";

type Phase = "camera" | "reading" | "check";

function readingSteps(mode: ScanMode): string[] {
  const found = sampleRead(mode, todayLocal()).length;
  return ["Photo is clear", `Found ${found} ${found === 1 ? "line" : "lines"}`, mode === "notebook" ? "Matching names to your customers" : "Reading the items and total", "Ready to check"];
}
const STEP_MS = 650;

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
    setPhoto(url);
    setPhase("reading");
  }
  const onRead = useCallback(() => setPhase("check"), []);

  if (phase === "camera") return <Camera mode={mode} onMode={setMode} onPhoto={onPhoto} />;
  if (phase === "reading") return <Reading mode={mode} photo={photo} onDone={onRead} />;
  return <Check mode={mode} photo={photo} onRetake={() => setPhase("camera")} />;
}

/* 1 · Camera */

type CameraState = "starting" | "live" | "unavailable";

function Camera({ mode, onMode, onPhoto }: { mode: ScanMode; onMode: (m: ScanMode) => void; onPhoto: (url: string) => void }) {
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
        <video ref={videoRef} className="scan-video" playsInline muted aria-label="Camera view" />
      ) : (
        <video ref={videoRef} className="scan-video" playsInline muted hidden />
      )}

      <div className="scan-camtop">
        <Link href="/" className="scan-round" aria-label="Close scanner">
          ✕
        </Link>
        <h1>Scan</h1>
        {torch.supported ? (
          <button
            type="button"
            className="scan-round"
            aria-pressed={torch.on}
            aria-label={torch.on ? "Turn flash off" : "Turn flash on"}
            onClick={toggleTorch}
          >
            ⚡
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
            {mode === "notebook" ? "Fit the whole page inside the frame" : "Fit the whole receipt inside the frame"}
          </p>
        </>
      )}

      {state === "starting" && <p className="scan-tip scan-tip-mid">Starting the camera…</p>}

      {state === "unavailable" && (
        <div className="scan-fallback">
          <p className="scan-fallback-title">Camera isn&apos;t available here</p>
          <p>Allow camera access in your browser, or take or choose a photo instead.</p>
          <button type="button" className="button button-primary" onClick={() => takeRef.current?.click()}>
            Take a photo
          </button>
          <button type="button" className="button scan-fallback-alt" onClick={() => galleryRef.current?.click()}>
            Choose from gallery
          </button>
        </div>
      )}

      <div className="scan-camfoot">
        <div className="scan-mode" role="group" aria-label="What are you scanning?">
          <button type="button" aria-pressed={mode === "notebook"} onClick={() => onMode("notebook")}>
            📒 Notebook
          </button>
          <button type="button" aria-pressed={mode === "receipt"} onClick={() => onMode("receipt")}>
            🧾 Receipt
          </button>
        </div>
        <div className="scan-controls">
          <button type="button" className="scan-gallery" onClick={() => galleryRef.current?.click()}>
            <span aria-hidden="true">🖼</span>
            Gallery
          </button>
          {state === "live" ? (
            <button type="button" className="scan-shutter" aria-label="Take photo" onClick={snap}>
              <b />
            </button>
          ) : (
            <span className="scan-shutter scan-shutter-off" aria-hidden="true">
              <b />
            </span>
          )}
          <span className="scan-gallery" aria-hidden="true" style={{ visibility: "hidden" }} />
        </div>
      </div>

      <input ref={galleryRef} type="file" accept="image/*" hidden onChange={onFile} />
      <input ref={takeRef} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
    </div>
  );
}

/* 2 · Reading */

function Reading({ mode, photo, onDone }: { mode: ScanMode; photo: string | null; onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [steps] = useState(() => readingSteps(mode));
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
        <h1>{mode === "notebook" ? "Reading your buku…" : "Reading your receipt…"}</h1>
        <p>This takes a few seconds.</p>
        <div className="scan-bar" role="progressbar" aria-label="Reading progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <b style={{ width: `${pct}%` }} />
        </div>
        <ul className="scan-steps">
          {steps.map((label, i) => (
            <li key={label} className={i < step ? "done" : i === step ? "now" : "later"}>
              <span aria-hidden="true">{i < step ? "✓" : i === step ? "⋯" : ""}</span>
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

function Check({ mode, photo, onRetake }: { mode: ScanMode; photo: string | null; onRetake: () => void }) {
  const router = useRouter();
  const { debts, ready, add, remove } = useDebts();
  const [today] = useState(() => todayLocal());
  const [lines, setLines] = useState<ScanLine[]>(() => sampleRead(mode, todayLocal()));
  const [open, setOpen] = useState<string | null>(mode === "receipt" ? "r1" : null);
  const [errors, setErrors] = useState<Record<string, DebtErrors>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pickNew, setPickNew] = useState(false);

  const known = customerNames(debts);
  const included = lines.filter((l) => l.include);
  const total = includedTotalSen(lines, today);

  function update(key: string, patch: Partial<ScanLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch, unsure: patch.include === undefined ? undefined : l.unsure } : l)));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: {} }));
  }

  function toggle(key: string, include: boolean) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, include } : l)));
    if (!include && errors[key]) setErrors((prev) => ({ ...prev, [key]: {} }));
  }

  function save() {
    setSaveError(null);
    const now = todayLocal();
    const result = linesToDebts(lines, now, { newId: newDebtId, now: new Date() });
    if (!result.ok) {
      setErrors(Object.fromEntries(result.problems.map((p) => [p.key, p.errors])));
      setOpen(result.problems[0].key);
      return;
    }
    setSaving(true);
    const added: string[] = [];
    try {
      for (const debt of result.debts) {
        add(debt);
        added.push(debt.id);
      }
    } catch (error) {
      // All or nothing: take back the ones that did save.
      for (const id of added) remove(id);
      setSaveError(error instanceof DebtStoreError ? error.message : "Couldn't save. Try again.");
      setSaving(false);
      return;
    }
    router.push(`/ledger?scanned=${result.debts.length}`);
  }

  const receipt = mode === "receipt" ? lines[0] : null;

  return (
    <div className="tab-page">
      <div className="tab-top">
        <button type="button" className="tab-back" aria-label="Back to camera" onClick={onRetake}>
          ←
        </button>
        <h1>{mode === "notebook" ? "Check the page" : "Check the receipt"}</h1>
        <span className="tab-back" aria-hidden="true" />
      </div>

      <section className="card scan-thumb">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element -- a local photo, not a site image
          <img src={photo} alt={mode === "notebook" ? "Your notebook photo" : "Your receipt photo"} />
        ) : (
          <span className="scan-thumb-empty" aria-hidden="true" />
        )}
        <div>
          <p className="tab-name">{mode === "notebook" ? "Notebook page" : "Receipt"}</p>
          <p className="tab-item">
            {formatDay(today).replace(/ \d{4}$/, "")} · {lines.length} {lines.length === 1 ? "line" : "lines"} found
          </p>
        </div>
        <button type="button" className="link-button scan-retake" onClick={onRetake}>
          Retake
        </button>
      </section>

      <p className="notice notice-warning scan-sample" role="note">
        Sample reading: the AI reader isn&apos;t connected yet, so these lines are examples, not your photo.
      </p>

      {saveError && (
        <p className="notice notice-error" role="alert">
          {saveError}
        </p>
      )}

      {receipt && (
        <section className="card scan-who">
          <label htmlFor="scan-customer">Which customer is this for?</label>
          <select
            id="scan-customer"
            value={pickNew ? NEW_NAME : receipt.customerName}
            aria-invalid={Boolean(errors[receipt.key]?.customerName) || undefined}
            aria-describedby={errors[receipt.key]?.customerName ? "scan-customer-error" : undefined}
            onChange={(e) => {
              if (e.target.value === NEW_NAME) {
                setPickNew(true);
                update(receipt.key, { customerName: "" });
              } else {
                setPickNew(false);
                update(receipt.key, { customerName: e.target.value });
              }
            }}
          >
            <option value="" disabled>
              {ready ? "Pick a customer" : "Loading customers…"}
            </option>
            {known.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
            <option value={NEW_NAME}>+ New customer</option>
          </select>
          {pickNew && (
            <input
              type="text"
              aria-label="New customer's name"
              placeholder="Customer's name"
              maxLength={MAX_NAME_LENGTH}
              value={receipt.customerName}
              onChange={(e) => update(receipt.key, { customerName: e.target.value })}
            />
          )}
          {errors[receipt.key]?.customerName && (
            <p className="field-error" id="scan-customer-error">
              Pick who this receipt is for.
            </p>
          )}
        </section>
      )}

      <p className="bill-meta">
        <span>
          {lines.length} {lines.length === 1 ? "line" : "lines"} · {included.length} ticked
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
                  aria-label={`Add ${l.customerName || "this line"}, RM ${l.amount || "no amount"}`}
                />
                <button
                  type="button"
                  className="scan-row-open"
                  aria-expanded={isOpen}
                  aria-controls={`scan-edit-${l.key}`}
                  onClick={() => setOpen(isOpen ? null : l.key)}
                >
                  <span className="tab-who">
                    <span className="tab-name">{l.customerName || (mode === "receipt" ? "Pick a customer above" : "No name")}</span>
                    <span className="tab-item">{l.item || "No item written"}</span>
                    {l.unsure && <span className="badge badge-unpaid badge-text">{l.unsure}</span>}
                    {fresh && <span className="badge badge-sent badge-text">New customer</span>}
                    {hasError && <span className="badge badge-overdue badge-text">Needs fixing</span>}
                  </span>
                  <span className="tab-amt">RM {l.amount || "—"}</span>
                </button>
              </div>
              {isOpen && (
                <div className="scan-edit" id={`scan-edit-${l.key}`}>
                  {mode === "notebook" && (
                    <EditField
                      id={`${l.key}-name`}
                      label="Customer"
                      value={l.customerName}
                      max={MAX_NAME_LENGTH}
                      error={lineErrors.customerName}
                      onChange={(v) => update(l.key, { customerName: v })}
                    />
                  )}
                  <EditField
                    id={`${l.key}-item`}
                    label="What they took"
                    value={l.item}
                    max={MAX_ITEM_LENGTH}
                    error={lineErrors.item}
                    onChange={(v) => update(l.key, { item: v })}
                  />
                  <EditField
                    id={`${l.key}-amount`}
                    label="Amount (RM)"
                    value={l.amount}
                    inputMode="decimal"
                    error={lineErrors.amount}
                    onChange={(v) => update(l.key, { amount: v })}
                  />
                  {lineErrors.date && <p className="field-error">{lineErrors.date}</p>}
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
        {included.length === 0
          ? "Tick at least one line"
          : `Add ${included.length} ${included.length === 1 ? "debt" : "debts"} to ledger`}
      </button>
      <p className="tab-note">Nothing is sent to customers until you approve invoices.</p>
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
