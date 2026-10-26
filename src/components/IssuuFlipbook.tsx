"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { motion, useMotionValue, useSpring, animate } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";

export interface SlideItem {
  id: string;
  src: string;
  title: string;
}

const DEFAULT_SLIDES: SlideItem[] = [
  { id: "slide-1", src: "/slides/slide-1.png", title: "Portada" },
  { id: "slide-2", src: "/slides/slide-2.png", title: "Visión Patrimonial" },
  { id: "slide-3", src: "/slides/slide-3.jpg", title: "Estilo de Vida" },
  { id: "slide-4", src: "/slides/slide-4.jpg", title: "Materialidad" },
  { id: "slide-5", src: "/slides/slide-5.jpg", title: "Acceso Monumental" },
  { id: "slide-6", src: "/slides/slide-6.jpg", title: "Amenidades & Bienestar" },
  { id: "slide-7", src: "/slides/slide-7.jpg", title: "Vida Activa & Familia" },
  { id: "slide-8", src: "/slides/slide-8.png", title: "Resumen del Desarrollo" },
  { id: "slide-9", src: "/slides/slide-9.png", title: "Restricciones de Lotes" },
];

type FlipDirection = "next" | "prev";

interface VirtualPage {
  image: HTMLImageElement | null;
  cropX: number;
  cropY: number;
  cropW: number;
  cropH: number;
}

export default function IssuuFlipbook({
  slides = DEFAULT_SLIDES,
}: {
  slides?: SlideItem[];
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [loadedImages, setLoadedImages] = useState<HTMLImageElement[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [spreadIndex, setSpreadIndex] = useState(0);
  const [isDraggingUI, setIsDraggingUI] = useState(false);

  // Native 16:9 panoramic spread dimensions:
  // Each half-page is 512 x 576 so the full spread is 1024 x 576 (exact 16:9 slide aspect ratio)
  const pageW = 512;
  const pageH = 576;
  const padX = 64;
  const padY = 64;
  const canvasW = pageW * 2 + padX * 2;
  const canvasH = pageH + padY * 2;

  // Build panoramic spreads (each slide split into left/right halves for the 3D page flip)
  const virtualSpreads = React.useMemo(() => {
    if (!isLoaded || loadedImages.length === 0) return [];
    return loadedImages.map((img) => {
      const w = img.naturalWidth || 1024;
      const h = img.naturalHeight || 576;
      return {
        fullImage: img,
        left: {
          image: img,
          cropX: 0,
          cropY: 0,
          cropW: w / 2,
          cropH: h,
        } as VirtualPage,
        right: {
          image: img,
          cropX: w / 2,
          cropY: 0,
          cropW: w / 2,
          cropH: h,
        } as VirtualPage,
      };
    });
  }, [isLoaded, loadedImages]);

  const totalSpreads = virtualSpreads.length;

  // Preload all 9 slide images
  useEffect(() => {
    let mounted = true;
    Promise.all(
      slides.map(
        (s) =>
          new Promise<HTMLImageElement>((resolve) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => resolve(img);
            img.onerror = () => resolve(img);
            img.src = s.src;
          })
      )
    ).then((imgs) => {
      if (mounted) {
        setLoadedImages(imgs);
        setIsLoaded(true);
      }
    });

    return () => {
      mounted = false;
    };
  }, [slides]);

  // ============================================================================
  // FRAMER MOTION PHYSICS & INTERACTIVE CURL STATE
  // ============================================================================
  const rawPointerX = useMotionValue(pageW);
  const rawPointerY = useMotionValue(pageH);

  const springX = useSpring(rawPointerX, {
    stiffness: 340,
    damping: 32,
    mass: 0.72,
  });
  const springY = useSpring(rawPointerY, {
    stiffness: 340,
    damping: 32,
    mass: 0.72,
  });

  const flipStateRef = useRef<{
    active: boolean;
    isDragging: boolean;
    isAnimatingTurn: boolean;
    direction: FlipDirection;
    originX: number;
    originY: number;
    targetSpreadIndex: number;
    lastPointerX: number;
    lastPointerTime: number;
    velocityX: number;
  }>({
    active: false,
    isDragging: false,
    isAnimatingTurn: false,
    direction: "next",
    originX: pageW,
    originY: pageH,
    targetSpreadIndex: 0,
    lastPointerX: 0,
    lastPointerTime: 0,
    velocityX: 0,
  });

  const constrainToSpinePhysics = useCallback(
    (px: number, py: number, originY: number) => {
      let x = px;
      let y = py;

      const dx1 = x;
      const dy1 = y - originY;
      const dist1 = Math.hypot(dx1, dy1);
      if (dist1 > pageW && dist1 > 0.0001) {
        const scale = pageW / dist1;
        x = dx1 * scale;
        y = originY + dy1 * scale;
      }

      const farY = pageH - originY;
      const maxDiag = Math.hypot(pageW, pageH);
      const dx2 = x;
      const dy2 = y - farY;
      const dist2 = Math.hypot(dx2, dy2);
      if (dist2 > maxDiag && dist2 > 0.0001) {
        const scale = maxDiag / dist2;
        x = dx2 * scale;
        y = farY + dy2 * scale;
      }

      return { x, y };
    },
    [pageW, pageH]
  );

  const drawVirtualPage = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      vpage: VirtualPage | undefined,
      dx: number,
      dy: number,
      dw: number,
      dh: number
    ) => {
      ctx.save();
      ctx.fillStyle = "#15161c";
      ctx.fillRect(dx, dy, dw, dh);

      if (vpage && vpage.image) {
        ctx.drawImage(
          vpage.image,
          vpage.cropX,
          vpage.cropY,
          vpage.cropW,
          vpage.cropH,
          dx,
          dy,
          dw,
          dh
        );
      }
      ctx.restore();
    },
    []
  );

  // ============================================================================
  // CORE 3D PAGE-FLIP CANVAS RENDERER
  // Flat & seamless when static; 3D curl + volume + dynamic shadows only while turning
  // ============================================================================
  const renderBookFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || virtualSpreads.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr =
      typeof window !== "undefined"
        ? Math.min(window.devicePixelRatio || 1, 2)
        : 1;
    if (canvas.width !== canvasW * dpr || canvas.height !== canvasH * dpr) {
      canvas.width = canvasW * dpr;
      canvas.height = canvasH * dpr;
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, canvasW, canvasH);

    // Move origin to top of central axis: (padX + pageW, padY)
    ctx.translate(padX + pageW, padY);

    const currentSpread = virtualSpreads[spreadIndex] || virtualSpreads[0];
    const st = flipStateRef.current;

    // -------------------------------------------------------------------------
    // STATIC STATE: Completely flat, zero central seam, zero spine shadow/volume
    // -------------------------------------------------------------------------
    if (!st.active) {
      if (currentSpread.fullImage) {
        ctx.drawImage(currentSpread.fullImage, -pageW, 0, pageW * 2, pageH);
      }
      ctx.restore();
      return;
    }

    const originX = st.originX;
    const originY = st.originY;
    const clamped = constrainToSpinePhysics(
      springX.get(),
      springY.get(),
      originY
    );
    const px = clamped.x;
    const py = clamped.y;

    const dx = originX - px;
    const dy = originY - py;
    const dist = Math.hypot(dx, dy);

    // If displacement is negligible, render completely flat without seam or volume
    if (dist < 1.5) {
      if (currentSpread.fullImage) {
        ctx.drawImage(currentSpread.fullImage, -pageW, 0, pageW * 2, pageH);
      }
      ctx.restore();
      return;
    }

    // -------------------------------------------------------------------------
    // ACTIVE FLIP STATE: Volume, spine crease, and 3D shadows emerge dynamically
    // -------------------------------------------------------------------------
    const progress = Math.min(1, Math.max(0, dist / (pageW * 2)));
    const archFactor = Math.sin(Math.PI * progress);

    const targetSpread =
      virtualSpreads[st.targetSpreadIndex] || currentSpread;

    // Draw base static halves
    if (st.direction === "next") {
      drawVirtualPage(ctx, currentSpread.left, -pageW, 0, pageW, pageH);
      drawVirtualPage(ctx, targetSpread.right, 0, 0, pageW, pageH);
    } else {
      drawVirtualPage(ctx, targetSpread.left, -pageW, 0, pageW, pageH);
      drawVirtualPage(ctx, currentSpread.right, 0, 0, pageW, pageH);
    }

    // Dynamic central spine volume (only visible while turning, proportional to archFactor)
    const drawDynamicSpineGutter = (intensity: number) => {
      if (intensity <= 0.01) return;
      ctx.save();
      const leftGutter = ctx.createLinearGradient(-44, 0, 0, 0);
      leftGutter.addColorStop(0, "rgba(0, 0, 0, 0)");
      leftGutter.addColorStop(0.65, `rgba(0, 0, 0, ${0.16 * intensity})`);
      leftGutter.addColorStop(0.96, `rgba(0, 0, 0, ${0.42 * intensity})`);
      leftGutter.addColorStop(1, `rgba(255, 255, 255, ${0.06 * intensity})`);
      ctx.fillStyle = leftGutter;
      ctx.fillRect(-44, 0, 44, pageH);

      const rightGutter = ctx.createLinearGradient(0, 0, 44, 0);
      rightGutter.addColorStop(0, `rgba(0, 0, 0, ${0.45 * intensity})`);
      rightGutter.addColorStop(0.35, `rgba(0, 0, 0, ${0.16 * intensity})`);
      rightGutter.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = rightGutter;
      ctx.fillRect(0, 0, 44, pageH);
      ctx.restore();
    };

    const ux = dx / dist;
    const uy = dy / dist;
    const tx = -uy;
    const ty = ux;

    const curlRadius = 26 * archFactor + 6;
    const mx = (originX + px) * 0.5;
    const my = (originY + py) * 0.5;

    const frontPage =
      st.direction === "next" ? currentSpread.right : currentSpread.left;
    const backPage =
      st.direction === "next" ? targetSpread.left : targetSpread.right;
    const pageMinX = st.direction === "next" ? 0 : -pageW;
    const pageMaxX = st.direction === "next" ? pageW : 0;

    // 1. Unfolded portion of turning page
    ctx.save();
    ctx.beginPath();
    ctx.rect(pageMinX, 0, pageW, pageH);
    ctx.clip();

    ctx.beginPath();
    const big = 3200;
    ctx.moveTo(mx + tx * big, my + ty * big);
    ctx.lineTo(mx - tx * big, my - ty * big);
    ctx.lineTo(mx - tx * big - ux * big, my - ty * big - uy * big);
    ctx.lineTo(mx + tx * big - ux * big, my + ty * big - uy * big);
    ctx.closePath();
    ctx.clip();

    drawVirtualPage(ctx, frontPage, pageMinX, 0, pageW, pageH);

    const preCreaseGrad = ctx.createLinearGradient(
      mx - ux * (curlRadius * 2.2),
      my - uy * (curlRadius * 2.2),
      mx,
      my
    );
    preCreaseGrad.addColorStop(0, "rgba(0, 0, 0, 0)");
    preCreaseGrad.addColorStop(0.7, `rgba(0, 0, 0, ${0.12 * archFactor})`);
    preCreaseGrad.addColorStop(
      1,
      `rgba(255, 255, 255, ${0.09 * archFactor})`
    );
    ctx.fillStyle = preCreaseGrad;
    ctx.fillRect(pageMinX, 0, pageW, pageH);
    ctx.restore();

    // Draw dynamic spine shadow only during the turn
    drawDynamicSpineGutter(archFactor);

    // 2. Compute lifted flap polygon
    const corners = [
      { x: pageMinX, y: 0 },
      { x: pageMaxX, y: 0 },
      { x: pageMaxX, y: pageH },
      { x: pageMinX, y: pageH },
    ];
    const liftedPoly: { x: number; y: number }[] = [];
    for (let i = 0; i < corners.length; i++) {
      const curr = corners[i];
      const prev = corners[(i + corners.length - 1) % corners.length];
      const dCurr = (curr.x - mx) * ux + (curr.y - my) * uy;
      const dPrev = (prev.x - mx) * ux + (prev.y - my) * uy;

      if (dCurr >= 0) {
        if (dPrev < 0) {
          const t = dPrev / (dPrev - dCurr);
          liftedPoly.push({
            x: prev.x + t * (curr.x - prev.x),
            y: prev.y + t * (curr.y - prev.y),
          });
        }
        liftedPoly.push(curr);
      } else if (dPrev >= 0) {
        const t = dPrev / (dPrev - dCurr);
        liftedPoly.push({
          x: prev.x + t * (curr.x - prev.x),
          y: prev.y + t * (curr.y - prev.y),
        });
      }
    }

    if (liftedPoly.length >= 3) {
      const reflectAndWarpPoint = (pt: { x: number; y: number }) => {
        const d = (pt.x - mx) * ux + (pt.y - my) * uy;
        const cylinderShift =
          curlRadius *
          Math.sin(Math.min(1, d / (curlRadius * 2.5)) * (Math.PI * 0.5));
        const effectiveD = d - cylinderShift * 0.18;
        const rx = pt.x - (d + effectiveD) * ux;
        const ry =
          pt.y - (d + effectiveD) * uy - archFactor * 10 * (d / pageW);
        return { x: rx, y: ry, d };
      };

      const reflectedPoly = liftedPoly.map(reflectAndWarpPoint);

      // Dynamic cast shadow under the turning page
      ctx.save();
      ctx.beginPath();
      ctx.rect(-pageW, 0, pageW * 2, pageH);
      ctx.clip();

      const shadowReach = 38 + 95 * archFactor;
      const castGrad = ctx.createLinearGradient(
        mx,
        my,
        mx - ux * (dist * 0.5 + shadowReach),
        my - uy * (dist * 0.5 + shadowReach)
      );
      castGrad.addColorStop(0, `rgba(0, 0, 0, ${0.52 * archFactor})`);
      castGrad.addColorStop(0.55, `rgba(0, 0, 0, ${0.28 * archFactor})`);
      castGrad.addColorStop(1, "rgba(0, 0, 0, 0)");

      ctx.save();
      ctx.shadowColor = `rgba(0, 0, 0, ${0.65 * archFactor})`;
      ctx.shadowBlur = 24 + 42 * archFactor;
      ctx.shadowOffsetX = -ux * (12 + 26 * archFactor);
      ctx.shadowOffsetY = 10 + 22 * archFactor;

      ctx.fillStyle = castGrad;
      ctx.beginPath();
      reflectedPoly.forEach((p, idx) => {
        if (idx === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // Crease occlusion shadow
      const creaseShadowW = 22 + 36 * archFactor;
      const creaseGrad = ctx.createLinearGradient(
        mx + ux * 6,
        my + uy * 6,
        mx - ux * creaseShadowW,
        my - uy * creaseShadowW
      );
      creaseGrad.addColorStop(0, "rgba(0, 0, 0, 0)");
      creaseGrad.addColorStop(0.22, `rgba(0, 0, 0, ${0.48 * archFactor})`);
      creaseGrad.addColorStop(1, "rgba(0, 0, 0, 0)");

      ctx.fillStyle = creaseGrad;
      ctx.beginPath();
      ctx.moveTo(mx + tx * big + ux * 6, my + ty * big + uy * 6);
      ctx.lineTo(mx - tx * big + ux * 6, my - ty * big + uy * 6);
      ctx.lineTo(
        mx - tx * big - ux * creaseShadowW,
        my - ty * big - uy * creaseShadowW
      );
      ctx.lineTo(
        mx + tx * big - ux * creaseShadowW,
        my + ty * big - uy * creaseShadowW
      );
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // 3. Curved Back-Side of Lifted Page
      ctx.save();
      ctx.beginPath();
      for (let i = 0; i < reflectedPoly.length; i++) {
        const curr = reflectedPoly[i];
        const next = reflectedPoly[(i + 1) % reflectedPoly.length];
        if (i === 0) ctx.moveTo(curr.x, curr.y);

        const midX = (curr.x + next.x) * 0.5;
        const midY = (curr.y + next.y) * 0.5;
        const edgeSpan = Math.hypot(next.x - curr.x, next.y - curr.y);
        const bowAmount =
          archFactor *
          Math.min(18, edgeSpan * 0.045) *
          (curr.d > 5 || next.d > 5 ? 1 : 0);

        ctx.quadraticCurveTo(
          midX - ux * bowAmount * 0.35,
          midY - bowAmount,
          next.x,
          next.y
        );
      }
      ctx.closePath();
      ctx.clip();

      ctx.save();
      const r00 = 1 - 2 * ux * ux;
      const r01 = -2 * ux * uy;
      const r10 = -2 * ux * uy;
      const r11 = 1 - 2 * uy * uy;

      ctx.translate(0, -archFactor * 6);
      ctx.translate(mx, my);
      ctx.transform(r00, r10, r01, r11, 0, 0);
      ctx.translate(-mx, -my);

      if (st.direction === "next") {
        ctx.translate(pageW, 0);
        ctx.scale(-1, 1);
        drawVirtualPage(ctx, backPage, 0, 0, pageW, pageH);
      } else {
        ctx.translate(-pageW, 0);
        ctx.scale(-1, 1);
        drawVirtualPage(ctx, backPage, 0, 0, pageW, pageH);
      }
      ctx.restore();

      // 3D Cylindrical lighting on the turning flap
      const flapSpan = Math.max(60, dist * 0.55);
      const bellyGrad = ctx.createLinearGradient(
        mx,
        my,
        mx - ux * flapSpan,
        my - uy * flapSpan
      );
      bellyGrad.addColorStop(0, `rgba(0, 0, 0, ${0.28 * archFactor})`);
      bellyGrad.addColorStop(
        0.08,
        `rgba(255, 255, 255, ${0.24 * archFactor})`
      );
      bellyGrad.addColorStop(
        0.28,
        `rgba(255, 252, 245, ${0.1 * archFactor})`
      );
      bellyGrad.addColorStop(0.72, "rgba(0, 0, 0, 0.04)");
      bellyGrad.addColorStop(1, `rgba(0, 0, 0, ${0.24 * archFactor})`);

      ctx.fillStyle = bellyGrad;
      ctx.fillRect(-pageW - padX, -padY, canvasW, canvasH);

      ctx.strokeStyle = `rgba(255, 248, 238, ${0.22 * archFactor})`;
      ctx.lineWidth = 1.2;
      ctx.stroke();

      ctx.restore();
    }

    ctx.restore();
  }, [
    canvasW,
    canvasH,
    pageW,
    pageH,
    padX,
    padY,
    spreadIndex,
    virtualSpreads,
    constrainToSpinePhysics,
    drawVirtualPage,
    springX,
    springY,
  ]);

  useEffect(() => {
    let rafId: number;
    const loop = () => {
      renderBookFrame();
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [renderBookFrame]);

  // ============================================================================
  // POINTER / TOUCH DRAG HANDLERS
  // ============================================================================
  const clientToBookCoords = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvasW / rect.width;
      const scaleY = canvasH / rect.height;
      const cx = (clientX - rect.left) * scaleX;
      const cy = (clientY - rect.top) * scaleY;
      return {
        x: cx - (padX + pageW),
        y: cy - padY,
      };
    },
    [canvasW, canvasH, padX, pageW, padY]
  );

  const triggerAnimatedTurn = useCallback(
    (dir: FlipDirection, customTargetIdx?: number) => {
      const st = flipStateRef.current;
      if (st.isAnimatingTurn) return;

      if (dir === "next" && spreadIndex >= totalSpreads - 1) return;
      if (dir === "prev" && spreadIndex <= 0) return;

      const nextIdx =
        customTargetIdx !== undefined
          ? customTargetIdx
          : dir === "next"
          ? spreadIndex + 1
          : spreadIndex - 1;

      const startX = dir === "next" ? pageW : -pageW;
      const endX = dir === "next" ? -pageW : pageW;

      st.active = true;
      st.isDragging = false;
      st.isAnimatingTurn = true;
      st.direction = dir;
      st.originX = startX;
      st.originY = pageH;
      st.targetSpreadIndex = nextIdx;

      rawPointerX.set(startX * 0.94);
      rawPointerY.set(pageH * 0.9);
      springX.jump(startX * 0.94);
      springY.jump(pageH * 0.9);

      animate(0, 1, {
        duration: 0.72,
        ease: [0.22, 1, 0.36, 1],
        onUpdate: (t) => {
          const curX = startX + (endX - startX) * t;
          const arcLift = Math.sin(Math.PI * t) * (pageH * 0.28);
          rawPointerX.set(curX);
          rawPointerY.set(pageH - arcLift);
        },
        onComplete: () => {
          setSpreadIndex(nextIdx);
          st.active = false;
          st.isAnimatingTurn = false;
        },
      });
    },
    [
      spreadIndex,
      totalSpreads,
      pageW,
      pageH,
      rawPointerX,
      rawPointerY,
      springX,
      springY,
    ]
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const st = flipStateRef.current;
    if (st.isAnimatingTurn) return;

    const pt = clientToBookCoords(e.clientX, e.clientY);
    if (
      pt.x < -pageW - 40 ||
      pt.x > pageW + 40 ||
      pt.y < -40 ||
      pt.y > pageH + 40
    ) {
      return;
    }

    const dir: FlipDirection = pt.x >= 0 ? "next" : "prev";
    if (dir === "next" && spreadIndex >= totalSpreads - 1) return;
    if (dir === "prev" && spreadIndex <= 0) return;

    e.currentTarget.setPointerCapture(e.pointerId);

    const originX = dir === "next" ? pageW : -pageW;
    const originY = pt.y < pageH * 0.45 ? 0 : pageH;

    st.active = true;
    st.isDragging = true;
    st.direction = dir;
    st.originX = originX;
    st.originY = originY;
    st.targetSpreadIndex = dir === "next" ? spreadIndex + 1 : spreadIndex - 1;
    st.lastPointerX = pt.x;
    st.lastPointerTime = performance.now();
    st.velocityX = 0;

    setIsDraggingUI(true);

    const clamped = constrainToSpinePhysics(pt.x, pt.y, originY);
    rawPointerX.set(clamped.x);
    rawPointerY.set(clamped.y);
    springX.jump(clamped.x);
    springY.jump(clamped.y);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const st = flipStateRef.current;
    if (st.isAnimatingTurn || !st.isDragging) return;

    const pt = clientToBookCoords(e.clientX, e.clientY);
    const now = performance.now();
    const dt = Math.max(1, now - st.lastPointerTime);
    st.velocityX = ((pt.x - st.lastPointerX) / dt) * 1000;
    st.lastPointerX = pt.x;
    st.lastPointerTime = now;

    const clamped = constrainToSpinePhysics(pt.x, pt.y, st.originY);
    rawPointerX.set(clamped.x);
    rawPointerY.set(clamped.y);
  };

  const finishDrag = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const st = flipStateRef.current;
    if (!st.isDragging) return;

    st.isDragging = false;
    setIsDraggingUI(false);

    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore
    }

    const curX = rawPointerX.get();
    const curY = rawPointerY.get();
    const vx = st.velocityX;

    const crossedSpine =
      st.direction === "next" ? curX < pageW * 0.25 : curX > -pageW * 0.25;
    const flicked = st.direction === "next" ? vx < -320 : vx > 320;
    const shouldCompleteTurn = crossedSpine || flicked;

    const destX = shouldCompleteTurn ? -st.originX : st.originX;
    const destY = st.originY;

    st.isAnimatingTurn = true;

    animate(0, 1, {
      duration: shouldCompleteTurn ? 0.48 : 0.36,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (t) => {
        const nx = curX + (destX - curX) * t;
        const arc = shouldCompleteTurn
          ? Math.sin(Math.PI * t) * (st.originY === 0 ? 35 : -35)
          : 0;
        const ny = curY + (destY - curY) * t + arc;
        rawPointerX.set(nx);
        rawPointerY.set(ny);
      },
      onComplete: () => {
        if (shouldCompleteTurn) {
          setSpreadIndex(st.targetSpreadIndex);
        }
        st.active = false;
        st.isAnimatingTurn = false;
      },
    });
  };

  // Keyboard navigation
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") triggerAnimatedTurn("next");
      if (e.key === "ArrowLeft") triggerAnimatedTurn("prev");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [triggerAnimatedTurn]);

  return (
    <div className="relative min-h-screen w-full bg-[#202026] text-white flex flex-col justify-between overflow-hidden select-none">
      {/* =====================================================================
          MAIN STAGE (Only side chevrons + 3D Flipbook Canvas)
         ===================================================================== */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-2 md:px-10">
        <div className="relative flex w-full max-w-[1440px] items-center justify-center">
          {/* Left Chevron */}
          <button
            onClick={() => triggerAnimatedTurn("prev")}
            disabled={spreadIndex <= 0}
            aria-label="Anterior"
            className="group absolute left-2 md:left-4 z-20 flex h-11 w-11 md:h-12 md:w-12 items-center justify-center rounded-full bg-black/45 text-white/90 shadow-lg border border-white/10 backdrop-blur-md transition-all hover:scale-105 hover:bg-black/75 hover:text-[#FFD7BA] disabled:pointer-events-none disabled:opacity-20"
          >
            <ChevronLeft className="h-5 w-5 transition-transform group-hover:-translate-x-0.5" />
          </button>

          {/* HTML5 3D Deformable Page-Flip Canvas */}
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            className="relative w-full flex items-center justify-center"
          >
            {!isLoaded ? (
              <div className="flex h-[420px] w-full max-w-4xl flex-col items-center justify-center gap-3">
                <div className="h-7 w-7 animate-spin rounded-full border-2 border-[#FFD7BA] border-t-transparent" />
              </div>
            ) : (
              <canvas
                ref={canvasRef}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={finishDrag}
                onPointerCancel={finishDrag}
                onPointerLeave={(e) => {
                  if (flipStateRef.current.isDragging) {
                    finishDrag(e);
                  }
                }}
                style={{
                  aspectRatio: `${canvasW} / ${canvasH}`,
                  touchAction: "none",
                }}
                className={`w-full max-h-[84vh] object-contain ${
                  isDraggingUI ? "cursor-grabbing" : "cursor-grab"
                }`}
              />
            )}
          </motion.div>

          {/* Right Chevron */}
          <button
            onClick={() => triggerAnimatedTurn("next")}
            disabled={spreadIndex >= totalSpreads - 1}
            aria-label="Siguiente"
            className="group absolute right-2 md:right-4 z-20 flex h-11 w-11 md:h-12 md:w-12 items-center justify-center rounded-full bg-black/45 text-white/90 shadow-lg border border-white/10 backdrop-blur-md transition-all hover:scale-105 hover:bg-black/75 hover:text-[#FFD7BA] disabled:pointer-events-none disabled:opacity-20"
          >
            <ChevronRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" />
          </button>
        </div>
      </main>

      {/* =====================================================================
          BOTTOM NAVIGATION BAR (2px full-width #FFD7BA top progress bar + counter + thumbnails)
         ===================================================================== */}
      <footer className="relative z-20 bg-[#18181D]/90 px-6 py-3 backdrop-blur-md">
        {/* Full-width 2px Progress Bar along the top border */}
        <div className="absolute top-0 left-0 right-0 h-[2px] w-full bg-white/10 overflow-hidden">
          <motion.div
            className="h-full bg-[#FFD7BA]"
            animate={{
              width: `${
                totalSpreads > 0
                  ? ((spreadIndex + 1) / totalSpreads) * 100
                  : 100
              }%`,
            }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
          />
        </div>

        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          {/* Numeric Counter (without the word "Pliego") */}
          <span className="rounded-md bg-white/[0.06] border border-white/10 px-2.5 py-1 font-mono text-[11px] font-medium text-[#FFD7BA]">
            {spreadIndex + 1} / {totalSpreads || 9}
          </span>

          {/* Interactive Slide Thumbnails */}
          <div className="flex items-center gap-2 overflow-x-auto py-1">
            {slides.map((slide, idx) => {
              const isActive = idx === spreadIndex;
              return (
                <button
                  key={slide.id}
                  onClick={() => {
                    if (idx === spreadIndex) return;
                    if (idx > spreadIndex) triggerAnimatedTurn("next", idx);
                    else triggerAnimatedTurn("prev", idx);
                  }}
                  className={`group relative flex items-center overflow-hidden rounded border transition-all ${
                    isActive
                      ? "border-[#FFD7BA] ring-1 ring-[#FFD7BA]/40 scale-105 shadow-sm"
                      : "border-white/15 opacity-55 hover:opacity-100"
                  }`}
                >
                  <div className="h-8 w-14 bg-[#15161C]">
                    <img
                      src={slide.src}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  </div>
                </button>
              );
            })}
          </div>

          {/* Empty spacer to balance flex layout */}
          <div className="w-12 hidden sm:block" />
        </div>
      </footer>
    </div>
  );
}
