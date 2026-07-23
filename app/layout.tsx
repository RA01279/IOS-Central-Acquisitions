import "./globals.css";
import ProductionRedirect from "@/components/ProductionRedirect";

export const metadata = {
  title: "Hopper",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ProductionRedirect />
        {children}
      </body>
    </html>
  );
}
