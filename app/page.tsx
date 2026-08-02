export default function HomePage() {
  return (
    <main className="min-h-screen bg-[#000614] text-white">
      <section className="flex min-h-screen items-center justify-center px-6">
        <div className="text-center">
          <p className="mb-4 text-sm uppercase tracking-[0.4em] text-white/60">
            Web3 NFT Collection
          </p>

          <h1 className="text-6xl font-black md:text-8xl">
            BOOM BIRDS
          </h1>

          <p className="mx-auto mt-6 max-w-xl text-lg text-white/70">
            Every egg holds a unique bird with personality, rarity, and story.
          </p>

          <div className="mt-8 flex justify-center gap-4">
            <a
              href="#mint"
              className="rounded-full bg-gradient-to-r from-[#FBBF24] to-[#F97316] px-7 py-4 font-bold text-[#1A1200]"
            >
              Mint Egg
            </a>

            <a
              href="#collection"
              className="rounded-full border border-white/15 bg-white/10 px-7 py-4 font-bold text-white"
            >
              View Collection
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}