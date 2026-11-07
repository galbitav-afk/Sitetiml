"use client";

import { useEffect } from "react";
import { pipeline } from "@/lib/pipeline";

/** Starts the background transcription/summary processor once per tab. */
export default function PipelineBoot() {
  useEffect(() => {
    void pipeline.init();
  }, []);
  return null;
}
