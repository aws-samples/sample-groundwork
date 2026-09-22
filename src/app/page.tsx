"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    const auth = localStorage.getItem("cf_auth");
    router.replace(auth ? "/console/sources" : "/login");
  }, [router]);
  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-white"><span className="text-indigo-400">Ground</span>Work</h1>
        <p className="text-zinc-400 mt-2">Loading...</p>
      </div>
    </div>
  );
}
