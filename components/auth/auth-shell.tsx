import * as React from "react";
import Image from "next/image";
import { CheckCircle2, ShieldCheck } from "lucide-react";

/**
 * Marco compartido de las pantallas sin sesión (login, recuperar contraseña).
 *
 * Dos columnas en pantallas grandes: panel de marca a la izquierda, formulario
 * a la derecha. En móvil el panel de marca desaparece por completo y queda solo
 * el formulario con un logo compacto arriba — el perito entra desde el celular
 * y ahí lo único que importa es llegar a los campos sin scrollear.
 *
 * El área del formulario usa tokens del tema, así que se ve bien en los tres
 * modos: claro, oscuro y alto contraste (el de trabajo a pleno sol).
 *
 * El panel de marca es la excepción a propósito: va en un azul oscuro FIJO en
 * vez de `bg-primary`. Con el token, en modo oscuro `primary` se invierte a un
 * color claro y el panel quedaba blanco contra un formulario negro — el
 * degradado de marca se daba vuelta según el tema. Como el panel solo aparece
 * en `lg:` (o sea, nunca en el celular, que es donde se usa el modo de alto
 * contraste a pleno sol), fijarlo es seguro y mantiene la identidad estable.
 */

const PILLARS = [
  {
    icon: ShieldCheck,
    title: "Informes verificables",
    body: "Cada peritaje se entrega firmado, con consecutivo oficial y un enlace público para que el cliente lo valide.",
  },
  {
    icon: CheckCircle2,
    title: "Calificación consistente",
    body: "El puntaje sale de un motor de reglas, no del criterio del día: dos peritos, el mismo resultado.",
  },
];

export function AuthShell({
  children,
  brandName = "Peritajes del Llano",
}: {
  children: React.ReactNode;
  brandName?: string;
}) {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[1.05fr_1fr]">
      {/* Panel de marca — solo desktop */}
      <aside className="relative hidden bg-slate-900 text-slate-50 lg:flex lg:flex-col lg:p-12">
        <div className="flex items-center gap-3">
          <Image
            src="/logo.jpg"
            alt=""
            width={44}
            height={44}
            className="h-11 w-11 rounded-lg object-cover"
            priority
          />
          <span className="text-lg font-semibold tracking-tight">
            {brandName}
          </span>
        </div>

        {/* my-auto: el logo queda arriba y el mensaje centrado en lo que sobra. */}
        <div className="my-auto max-w-md">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">
            El peritaje vehicular, hecho como debe ser.
          </h2>
          <ul className="mt-10 space-y-7">
            {PILLARS.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex gap-4">
                <Icon
                  className="mt-0.5 h-5 w-5 shrink-0 opacity-90"
                  aria-hidden="true"
                />
                <div>
                  <p className="font-medium">{title}</p>
                  <p className="mt-1 text-sm leading-relaxed opacity-75">
                    {body}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>

      </aside>

      {/* Formulario */}
      <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-10 lg:min-h-0 lg:bg-background">
        <div className="w-full max-w-sm">
          {/* Logo compacto: solo en móvil, donde no hay panel de marca */}
          <div className="mb-8 flex flex-col items-center gap-3 lg:hidden">
            <Image
              src="/logo.jpg"
              alt=""
              width={56}
              height={56}
              className="h-14 w-14 rounded-xl object-cover"
              priority
            />
            <span className="text-base font-semibold tracking-tight">
              {brandName}
            </span>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
