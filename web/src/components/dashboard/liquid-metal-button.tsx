import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { liquidMetalFragmentShader, LiquidMetalShapes, ShaderMount } from "@paper-design/shaders";

interface LiquidMetalButtonProps {
    label?: string;
    fullWidth?: boolean;
    disabled?: boolean;
    title?: string;
    type?: "button" | "submit";
    className?: string;
    onClick?: () => void;
    viewMode?: "text" | "icon";
    href?: string;
}

export function LiquidMetalButton({
    label = "Get Started",
    onClick,
    viewMode = "text",
    fullWidth = false,
    disabled = false,
    title,
    type = "button",
    className = "",
    href,
}: LiquidMetalButtonProps) {
    const [isHovered, setIsHovered] = useState(false);
    const [isPressed, setIsPressed] = useState(false);
    const [ripples, setRipples] = useState<Array<{ x: number; y: number; id: number }>>([]);
    const shaderRef = useRef<HTMLDivElement>(null);
    const shaderMount = useRef<ShaderMount | null>(null);
    const buttonRef = useRef<HTMLElement>(null);
    const rippleId = useRef(0);

    const dimensions = useMemo(() => {
        if (viewMode === "icon") {
            return {
                width: 46,
                height: 46,
                innerWidth: 42,
                innerHeight: 42,
                shaderWidth: 46,
                shaderHeight: 46,
            };
        } else {
            return {
                width: 142,
                height: 46,
                innerWidth: 138,
                innerHeight: 42,
                shaderWidth: 142,
                shaderHeight: 46,
            };
        }
    }, [viewMode]);

    useEffect(() => {
        const styleId = "shader-canvas-style-exploded";
        if (!document.getElementById(styleId)) {
            const style = document.createElement("style");
            style.id = styleId;
            style.textContent = `
        .shader-container-exploded canvas {
          width: 100% !important;
          height: 100% !important;
          display: block !important;
          position: absolute !important;
          top: 0 !important;
          left: 0 !important;
          border-radius: 6px !important;
        }
        @keyframes ripple-animation {
          0% {
            transform: translate(-50%, -50%) scale(0);
            opacity: 0.6;
          }
          100% {
            transform: translate(-50%, -50%) scale(4);
            opacity: 0;
          }
        }
      `;
            document.head.appendChild(style);
        }

        const loadShader = async () => {
            try {
                if (shaderRef.current) {
                    shaderMount.current?.dispose();

                    shaderMount.current = new ShaderMount(
                        shaderRef.current,
                        liquidMetalFragmentShader,
                        {
                            u_repetition: 4,
                            u_softness: 0.5,
                            u_shiftRed: 0.3,
                            u_shiftBlue: 0.3,
                            u_distortion: 0,
                            u_contour: 0,
                            u_angle: 45,
                            u_scale: 8,
                            // CSS defines the rounded frame, so the shader must cover the entire canvas
                            u_shape: LiquidMetalShapes.none,
                            u_originX: 0.5,
                            u_originY: 0.5,
                            u_offsetX: 0,
                            u_offsetY: 0,
                        },
                        undefined,
                        0.6,
                    );
                }
            } catch (error) {
                console.error("[v0] Failed to load shader:", error);
            }
        };

        loadShader();

        return () => {
            shaderMount.current?.dispose();
            shaderMount.current = null;
        };
    }, []);

    const handleMouseEnter = () => {
        setIsHovered(true);
        shaderMount.current?.setSpeed?.(1);
    };

    const handleMouseLeave = () => {
        setIsHovered(false);
        setIsPressed(false);
        shaderMount.current?.setSpeed?.(0.6);
    };

    const handleClick = (e: React.MouseEvent<HTMLElement>) => {
        if (shaderMount.current?.setSpeed) {
            shaderMount.current.setSpeed(2.4);
            setTimeout(() => {
                if (isHovered) {
                    shaderMount.current?.setSpeed?.(1);
                } else {
                    shaderMount.current?.setSpeed?.(0.6);
                }
            }, 300);
        }

        if (buttonRef.current) {
            const rect = buttonRef.current.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const ripple = { x, y, id: rippleId.current++ };

            setRipples((prev) => [...prev, ripple]);
            setTimeout(() => {
                setRipples((prev) => prev.filter((r) => r.id !== ripple.id));
            }, 600);
        }

        onClick?.();
    };

    return (
        // Isolated because the four layers below carry their own z-index, which without a context here
        // outranks the drawer and the sidebar rather than ordering the button against itself
        <div
            className={`liquid-metal ${className}`}
            style={{
                isolation: "isolate",
                width: fullWidth ? "100%" : undefined,
                opacity: disabled ? 0.45 : undefined,
            }}
        >
            <div
                style={{
                    perspective: "none",
                    perspectiveOrigin: "50% 50%",
                }}
            >
                <div
                    style={{
                        position: "relative",
                        width: fullWidth ? "100%" : `${dimensions.width}px`,
                        height: `${dimensions.height}px`,
                        transformStyle: "flat",
                        transition: "all 0.8s cubic-bezier(0.34, 1.56, 0.64, 1), width 0.4s ease, height 0.4s ease",
                        transform: "none",
                    }}
                >
                    <div
                        style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            width: fullWidth ? "100%" : `${dimensions.width}px`,
                            height: `${dimensions.height}px`,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "6px",
                            transformStyle: "flat",
                            transition:
                                "all 0.8s cubic-bezier(0.34, 1.56, 0.64, 1), width 0.4s ease, height 0.4s ease, gap 0.4s ease",
                            transform: "none",
                            zIndex: 30,
                            pointerEvents: "none",
                        }}
                    >
                        {viewMode === "text" && (
                            <span
                                style={{
                                    fontSize: "14px",
                                    color: "#fdfdfd",
                                    fontWeight: 400,
                                    textShadow: "0px 1px 2px rgba(0, 0, 0, 0.5)",
                                    transition: "all 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)",
                                    transform: "scale(1)",
                                    whiteSpace: "nowrap",
                                }}
                            >
                                {label}
                            </span>
                        )}
                    </div>

                    <div
                        style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            width: fullWidth ? "100%" : `${dimensions.width}px`,
                            height: `${dimensions.height}px`,
                            transformStyle: "flat",
                            transition: "all 0.8s cubic-bezier(0.34, 1.56, 0.64, 1), width 0.4s ease, height 0.4s ease",
                            transform: "none",
                            zIndex: 20,
                        }}
                    >
                        <div
                            style={{
                                width: fullWidth ? "calc(100% - 4px)" : `${dimensions.innerWidth}px`,
                                height: `${dimensions.innerHeight}px`,
                                margin: "2px",
                                borderRadius: "4px",
                                background: "linear-gradient(21deg, #1c1c1c 0%, #212121 100%)",
                                boxShadow: isPressed
                                    ? "inset 0px 2px 4px rgba(0, 0, 0, 0.4), inset 0px 1px 2px rgba(0, 0, 0, 0.3)"
                                    : "none",
                                transition:
                                    "all 0.8s cubic-bezier(0.34, 1.56, 0.64, 1), width 0.4s ease, height 0.4s ease, box-shadow 0.15s cubic-bezier(0.4, 0, 0.2, 1)",
                            }}
                        />
                    </div>

                    <div
                        style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            width: fullWidth ? "100%" : `${dimensions.width}px`,
                            height: `${dimensions.height}px`,
                            transformStyle: "flat",
                            transition: "all 0.8s cubic-bezier(0.34, 1.56, 0.64, 1), width 0.4s ease, height 0.4s ease",
                            transform: "none",
                            zIndex: 10,
                        }}
                    >
                        <div
                            style={{
                                height: `${dimensions.height}px`,
                                width: fullWidth ? "100%" : `${dimensions.width}px`,
                                borderRadius: "6px",
                                boxShadow: isPressed
                                    ? "0px 0px 0px 1px rgba(0, 0, 0, 0.5), 0px 1px 2px 0px rgba(0, 0, 0, 0.3)"
                                    : isHovered
                                      ? "0px 0px 0px 1px rgba(0, 0, 0, 0.4), 0px 12px 6px 0px rgba(0, 0, 0, 0.05), 0px 8px 5px 0px rgba(0, 0, 0, 0.1), 0px 4px 4px 0px rgba(0, 0, 0, 0.15), 0px 1px 2px 0px rgba(0, 0, 0, 0.2)"
                                      : "0px 0px 0px 1px rgba(0, 0, 0, 0.3), 0px 36px 14px 0px rgba(0, 0, 0, 0.02), 0px 20px 12px 0px rgba(0, 0, 0, 0.08), 0px 9px 9px 0px rgba(0, 0, 0, 0.12), 0px 2px 5px 0px rgba(0, 0, 0, 0.15)",
                                transition:
                                    "all 0.8s cubic-bezier(0.34, 1.56, 0.64, 1), width 0.4s ease, height 0.4s ease, box-shadow 0.15s cubic-bezier(0.4, 0, 0.2, 1)",
                                background: "rgb(0 0 0 / 0)",
                            }}
                        >
                            <div
                                ref={shaderRef}
                                className="shader-container-exploded"
                                style={{
                                    borderRadius: "6px",
                                    overflow: "hidden",
                                    position: "relative",
                                    width: fullWidth ? "100%" : `${dimensions.shaderWidth}px`,
                                    maxWidth: fullWidth ? "100%" : `${dimensions.shaderWidth}px`,
                                    height: `${dimensions.shaderHeight}px`,
                                    transition: "width 0.4s ease, height 0.4s ease",
                                }}
                            />
                        </div>
                    </div>

                    {(() => {
                        const surface = {
                            position: "absolute" as const,
                            top: 0,
                            left: 0,
                            width: fullWidth ? "100%" : `${dimensions.width}px`,
                            height: `${dimensions.height}px`,
                            background: "transparent",
                            border: "none",
                            cursor: "pointer",
                            outline: "none",
                            zIndex: 40,
                            transformStyle: "flat" as const,
                            transform: "translateZ(25px)",
                            transition: "all 0.8s cubic-bezier(0.34, 1.56, 0.64, 1), width 0.4s ease, height 0.4s ease",
                            overflow: "hidden",
                            borderRadius: "6px",
                        };
                        const shared = {
                            title,
                            onClick: handleClick,
                            onMouseEnter: handleMouseEnter,
                            onMouseLeave: handleMouseLeave,
                            onMouseDown: () => setIsPressed(true),
                            onMouseUp: () => setIsPressed(false),
                            style: surface,
                            "aria-label": label,
                        };
                        const wash = ripples.map((ripple) => (
                            <span
                                key={ripple.id}
                                style={{
                                    position: "absolute",
                                    left: `${ripple.x}px`,
                                    top: `${ripple.y}px`,
                                    width: "20px",
                                    height: "20px",
                                    borderRadius: "50%",
                                    background:
                                        "radial-gradient(circle, rgba(255, 255, 255, 0.4) 0%, rgba(255, 255, 255, 0) 70%)",
                                    pointerEvents: "none",
                                    animation: "ripple-animation 0.6s ease-out",
                                }}
                            />
                        ));
                        // An href turns the control into a real link, so a landing CTA keeps its navigation semantics
                        return href ? (
                            <a ref={buttonRef as React.RefObject<HTMLAnchorElement>} href={href} {...shared}>
                                {wash}
                            </a>
                        ) : (
                            <button
                                ref={buttonRef as React.RefObject<HTMLButtonElement>}
                                type={type}
                                disabled={disabled}
                                {...shared}
                            >
                                {wash}
                            </button>
                        );
                    })()}
                </div>
            </div>
        </div>
    );
}
