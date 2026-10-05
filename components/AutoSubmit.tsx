"use client";
// A <select> that submits its form on change -- filters that live in the URL
// without a separate "Apply" button.

export default function AutoSubmit({
  name,
  value,
  children,
  ...rest
}: {
  name: string;
  value: string;
  children: React.ReactNode;
  "aria-label"?: string;
}) {
  return (
    <select name={name} defaultValue={value} onChange={(e) => e.currentTarget.form?.requestSubmit()} {...rest}>
      {children}
    </select>
  );
}
