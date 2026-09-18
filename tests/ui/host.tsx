import type { PropsWithChildren } from "react";
import { createPortal } from "react-dom";
import { Text, View } from "react-native";
export { FlatList, ScrollView, TextInput } from "react-native";

export const clipboard = { text: "", fail: false };
export async function copyText(text: string) {
  if (clipboard.fail) throw new Error("Clipboard unavailable");
  clipboard.text = text;
}

// Test-only replacements for components injected by the Paseo client.
export function Icon({ color, size }: { name: string; color?: string; size?: number }) {
  return <Text style={{ color, fontSize: size }}>▤</Text>;
}
export const Modal = Object.assign(
  function Modal({
    open,
    title,
    onOpenChange,
    children,
  }: PropsWithChildren<{ open: boolean; title: string; onOpenChange: (open: boolean) => void }>) {
    if (!open) return null;
    return createPortal(
      <div
        role="dialog"
        aria-label={title}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 2,
          background: "#0008",
          display: "grid",
          placeItems: "center",
          padding: 12,
        }}
      >
        <div
          style={{
            width: "min(880px, 100%)",
            maxHeight: "95vh",
            overflow: "auto",
            background: "var(--preview-surface)",
            border: "1px solid #666",
            borderRadius: 14,
          }}
        >
          <div style={{ padding: 14, display: "flex", justifyContent: "space-between" }}>
            <strong>{title}</strong>
            <button aria-label="关闭弹窗" onClick={() => onOpenChange(false)}>
              关闭
            </button>
          </div>
          {children}
        </div>
      </div>,
      document.getElementById("preview-overlays")!,
    );
  },
  {
    Content: ({
      children,
    }: PropsWithChildren<{ scrollable?: boolean; contentContainerStyle?: unknown }>) => (
      <View style={{ gap: 12, padding: 12 }}>{children}</View>
    ),
  },
);

export function SettingsSection({ title, children }: PropsWithChildren<{ title: string }>) {
  return (
    <View style={{ gap: 12 }}>
      <h3>{title}</h3>
      {children}
    </View>
  );
}
export function SettingsCard({ children }: PropsWithChildren) {
  return <View style={{ gap: 12 }}>{children}</View>;
}
export function SettingsSelect({
  label,
  value,
  options,
  disabled,
  onValueChange,
}: {
  label: string;
  value: string;
  options: { label: string; value: string }[];
  disabled?: boolean;
  onValueChange: (value: string) => void;
}) {
  return (
    <label style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      {label}
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onValueChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
export function SettingsInput({
  label,
  placeholder,
  disabled,
  onChangeText,
}: {
  label: string;
  placeholder?: string;
  disabled?: boolean;
  onChangeText: (value: string) => void;
}) {
  return (
    <label style={{ display: "grid", gap: 8 }}>
      {label}
      <input
        aria-label={label}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onChangeText(event.target.value)}
      />
    </label>
  );
}
