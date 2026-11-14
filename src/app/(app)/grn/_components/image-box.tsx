"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, ImageUp, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { compressImage } from "@/lib/image-compress";
import { cn } from "@/lib/utils";
import { uploadProductImage } from "../actions";

export const imageUrl = (path: string | null | undefined) => (path ? `/uploads/${path}` : null);

/**
 * Product photo: "Capture" opens the camera (phone camera app on touch
 * devices, a live webcam preview on desktop), "Upload" picks a file. The image
 * is compressed in the browser, then uploaded right away.
 */
export function ImageBox({ value, onChange, disabled }: { value: string | null; onChange: (path: string | null) => void; disabled?: boolean }) {
  const toast = useToast();
  const captureRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [webcam, setWebcam] = useState(false);

  const handle = async (file: Blob | undefined | null) => {
    if (!file) return;
    setBusy(true);
    try {
      const small = await compressImage(file);
      const fd = new FormData();
      fd.set("image", new File([small], "photo.jpg", { type: "image/jpeg" }));
      const r = await uploadProductImage(fd);
      if (r.ok && r.data) onChange(r.data.imagePath);
      else toast.error((!r.ok && r.error) || "Upload failed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't read this image");
    } finally {
      setBusy(false);
      if (captureRef.current) captureRef.current.value = "";
      if (uploadRef.current) uploadRef.current.value = "";
    }
  };

  const capture = () => {
    const touch = window.matchMedia?.("(pointer: coarse)").matches;
    if (!touch && typeof navigator.mediaDevices?.getUserMedia === "function") setWebcam(true);
    else captureRef.current?.click();
  };

  const url = imageUrl(value);
  return (
    <div className="flex h-full flex-col gap-2">
      <div
        className={cn(
          "relative flex min-h-[140px] flex-1 items-center justify-center overflow-hidden rounded-md border-2 border-dashed border-border bg-slate-50",
          disabled && "opacity-60",
        )}
      >
        {busy ? (
          <Loader2 className="size-6 animate-spin text-muted" aria-label="Uploading" />
        ) : url ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="Item photo" className="max-h-[180px] max-w-full object-contain" />
            {!disabled && (
              <button
                type="button"
                aria-label="Remove photo"
                onClick={() => onChange(null)}
                className="absolute right-1 top-1 rounded-full bg-white/90 p-1 shadow hover:bg-white"
              >
                <X className="size-4" />
              </button>
            )}
          </>
        ) : (
          <button type="button" disabled={disabled} onClick={capture} className="flex flex-col items-center gap-1 text-sm text-muted hover:text-primary disabled:hover:text-muted">
            <Camera className="size-7" />
            Capture / Upload
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="secondary" size="sm" disabled={disabled || busy} onClick={capture}>
          <Camera /> Capture
        </Button>
        <Button type="button" variant="secondary" size="sm" disabled={disabled || busy} onClick={() => uploadRef.current?.click()}>
          <ImageUp /> Upload
        </Button>
      </div>
      <input ref={captureRef} type="file" accept="image/*" capture="environment" className="hidden" tabIndex={-1} onChange={(e) => handle(e.target.files?.[0])} />
      <input ref={uploadRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" tabIndex={-1} onChange={(e) => handle(e.target.files?.[0])} />
      <WebcamModal
        open={webcam}
        onClose={() => setWebcam(false)}
        onCapture={(b) => {
          setWebcam(false);
          void handle(b);
        }}
        onUnavailable={() => {
          setWebcam(false);
          captureRef.current?.click();
        }}
      />
    </div>
  );
}

function WebcamModal({
  open,
  onClose,
  onCapture,
  onUnavailable,
}: {
  open: boolean;
  onClose: () => void;
  onCapture: (b: Blob) => void;
  onUnavailable: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const unavailableRef = useRef(onUnavailable);
  unavailableRef.current = onUnavailable;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setReady(false);
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment", width: { ideal: 1920 } }, audio: false })
      .then((stream) => {
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
        setReady(true);
      })
      .catch(() => !cancelled && unavailableRef.current());
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [open]);

  const snap = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")?.drawImage(v, 0, 0);
    c.toBlob((b) => b && onCapture(b), "image/jpeg", 0.92);
  };

  return (
    <Modal
      open={open}
      title="Capture photo"
      onClose={onClose}
      width={640}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={snap} disabled={!ready} data-autofocus>
            <Camera /> Take photo
          </Button>
        </>
      }
    >
      <div className="flex aspect-video items-center justify-center overflow-hidden rounded-md bg-slate-900">
        <video ref={videoRef} playsInline muted className="h-full w-full object-contain" />
        {!ready && <Loader2 className="absolute size-6 animate-spin text-white" />}
      </div>
    </Modal>
  );
}
