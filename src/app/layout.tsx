import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Focal Dither",
  description: "Shader tool: dither, blur, noise and ASCII radiating from a focal point.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
