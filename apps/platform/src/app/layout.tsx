import type { ReactNode } from "react";

export const metadata = {
  title: "MN Data Platform",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="mn">
      <body>{children}</body>
    </html>
  );
}
