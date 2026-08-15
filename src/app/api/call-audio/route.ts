import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/config";

async function getUser(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return null;
  const userClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
  const { data } = await userClient.auth.getUser();
  return data.user;
}

export async function GET(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const vapiCallId = searchParams.get("vapi_call_id");
  const businessId = searchParams.get("business_id");

  if (!vapiCallId || !businessId) {
    return NextResponse.json({ error: "vapi_call_id and business_id required" }, { status: 400 });
  }

  const { data: biz } = await supabaseAdmin
    .from("businesses")
    .select("id")
    .eq("id", businessId)
    .eq("user_id", user.id)
    .single();
  if (!biz) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: call } = await supabaseAdmin
    .from("call_logs")
    .select("id, recording_url")
    .eq("business_id", businessId)
    .eq("vapi_call_id", vapiCallId)
    .single();
  if (!call) return NextResponse.json({ error: "Call not found" }, { status: 404 });

  if (call.recording_url) {
    const direct = await fetch(call.recording_url);
    if (direct.ok) {
      const buf = await direct.arrayBuffer();
      return new NextResponse(buf, {
        headers: {
          "Content-Type": direct.headers.get("content-type") || "audio/wav",
          "Cache-Control": "private, max-age=3600",
        },
      });
    }
  }

  if (!process.env.VAPI_API_KEY) {
    return NextResponse.json({ error: "Recording not available" }, { status: 404 });
  }

  const vapiRes = await fetch(`https://api.vapi.ai/call/${vapiCallId}/mono-recording`, {
    headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}` },
    redirect: "follow",
  });

  if (!vapiRes.ok) {
    return NextResponse.json({ error: "Recording not found on Vapi" }, { status: 404 });
  }

  const buf = await vapiRes.arrayBuffer();
  const contentType = vapiRes.headers.get("content-type") || "audio/wav";
  return new NextResponse(buf, {
    headers: { "Content-Type": contentType, "Cache-Control": "private, max-age=3600" },
  });
}
