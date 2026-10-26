import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rancho San Antonio | Interactive 3D Flipbook Presentation",
  description:
    "Experiencia editorial interactiva 3D estilo Issuu para Rancho San Antonio — Tu espacio en la naturaleza. Tu patrimonio para el futuro.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className="antialiased selection:bg-[#15161C] selection:text-[#E3B898]">
        {children}
      </body>
    </html>
  );
}
