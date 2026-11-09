// app/api/contacts/brokers/route.ts
//
// The broker picker's two calls (components/BrokerPicker.tsx):
//   PUT  { text } or { people } -> { brokers: [{ input, exact, close }] }  who's this?
//   POST { entries } -> { contactIds }                        save / find them
// PUT only reads; POST creates whoever is new (lib/broker-contacts.ts).
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { brokerEntries, brokerInputs, ensureBrokers, proposeBrokers } from "@/lib/broker-contacts";

export async function PUT(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.slice(0, 2000) : "";
  try {
    return NextResponse.json({ brokers: await proposeBrokers(Array.isArray(body?.people) ? brokerInputs(body.people) : text) });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const entries = brokerEntries(body?.entries, null);
  if (!entries.length) return NextResponse.json({ error: "No brokers to save" }, { status: 400 });
  try {
    return NextResponse.json({ contactIds: await ensureBrokers(entries) });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
