export const UI_COPY = {
  fees: {
    totalCostLabel: "Total cost",
    calculating: "Calculating...",
    unavailableValue: "—",
    unavailable: "Fee unavailable",
    mintNote:
      "The cost covers your Bird's random draw and the network.",
    checkpointNotReady: (date: string) =>
      `Your Bird isn't ready yet. Try again on ${date}.`,
  },
  confirmation: {
    metamask: "Waiting...",
    networkSetup: "Waiting...",
    google: "Confirming...",
    unknown: "Waiting for confirmation...",
  },
  actions: {
    getTestFunds: "Get Free Test Funds",
  },
  checkInPreview: {
    progress: (current: number) => `Preview check-in ${current}/10. Progress is local only.`,
    action: "Preview Only",
  },
  howItWorks: {
    title: "How It Works",
    subtitle: "From your first sign-in to your first Bird, Eggoria guides you through every step.",
    steps: [
      { title: "Start Your Journey", description: "Continue with Google for easy setup, or use your wallet." },
      { title: "Get Free Test Funds", description: "Claim free Test USDC to cover the small network fee." },
      { title: "Mint Your Egg", description: "Mint one Mystery Egg and start your evolution journey." },
      { title: "Check In & Evolve", description: "Come back regularly to help your Bird grow and evolve." },
    ],
  },
  toasts: {
    transactionCancelled: "Transaction cancelled.",
  },
} as const;
