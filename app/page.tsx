import Script from "next/script";

import EggoriaLanding from "./eggoria-landing";

export default function HomePage() {
  return (
    <>
      <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" />
      <EggoriaLanding
        googleClientId={process.env.GOOGLE_CLIENT_ID ?? ""}
        thirdwebClientId={process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID ?? ""}
        eggoriaBirdsAddress={process.env.NEXT_PUBLIC_EGGORIA_BIRDS_ADDRESS ?? ""}
      />
    </>
  );
}
