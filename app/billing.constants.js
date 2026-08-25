export const PACK_10K = "10K Code Pack";
export const PACK_100K = "100K Code Pack";
export const PACK_250K = "250K Code Pack";

export const PAYG_PACKS = {
  FREE: { name: "Free Tier Baseline", limitAdd: 0, initialLimit: 250, price: "$0", packKey: "FREE" },
  [PACK_10K]: { name: "10K Code Top-Up", limitAdd: 10000, price: "$1", amount: 1.0, packKey: "PACK_10K" },
  [PACK_100K]: { name: "100K Code Top-Up", limitAdd: 100000, price: "$3", amount: 3.0, packKey: "PACK_100K" },
  [PACK_250K]: { name: "250K Code Top-Up", limitAdd: 250000, price: "$5", amount: 5.0, packKey: "PACK_250K" },
};
