import React, { useState, useEffect } from "react";

export const ADD_PROMPTS = [
  "Add by ISBN",
  "Add by URL",
  "Add by title and author",
  "Add by artist and album",
  "Add by Discogs link"
];

export default function RotatingHintInput(props: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onFocus?: (e: React.FocusEvent<HTMLInputElement>) => void;
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  style?: React.CSSProperties;
  className?: string;
  autoFocus?: boolean;
  isMobile?: boolean;
}) {
  const { value, onChange, onFocus, onBlur, onKeyDown, style, className, autoFocus, isMobile } = props;
  const [index, setIndex] = useState(0);
  const [focused, setFocused] = useState(false);
  const [opacity, setOpacity] = useState(1);
  const [translateY, setTranslateY] = useState(0);

  useEffect(() => {
    if (focused || value) return;
    
    const timer = setInterval(() => {
      // Phase 1: Fade out and move up slightly
      setOpacity(0);
      setTranslateY(-4);
      
      setTimeout(() => {
        // Change text while invisible
        setIndex((prev) => (prev + 1) % ADD_PROMPTS.length);
        // Reset position to slightly below
        setTranslateY(3);
        
        // Phase 2: Fade in and move to center
        setTimeout(() => {
          setOpacity(1);
          setTranslateY(0);
        }, 50);
      }, 300);
    }, 3000);

    return () => clearInterval(timer);
  }, [focused, value]);

  const showHint = !value && !focused;

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <input
        {...props}
        placeholder="" // Hide native placeholder
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={{ ...style, width: "100%" }}
      />
      {showHint && (
        <div
          style={{
            position: "absolute",
            left: 0,
            bottom: isMobile ? 12 : 10, // Higher on mobile to match baseline
            transform: `translateY(${translateY}px)`,
            pointerEvents: "none",
            color: "var(--text-muted)",
            opacity: opacity * 0.6,
            transition: "opacity 0.3s ease, transform 0.3s ease",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: "calc(100% - 20px)",
            fontSize: "inherit",
            fontFamily: "inherit",
            lineHeight: "inherit"
          }}
        >
          {ADD_PROMPTS[index]}
        </div>
      )}
    </div>
  );
}
