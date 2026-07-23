// lib/crm.ts
//
// Data-access helpers for the CRM side of Hopper: companies, contacts, the
// deal<->contact links, activities, and follow-up tasks. Same pattern as
// lib/deals.ts -- server-side only, via the service-role client. Screens and
// API routes call these; nothing here reaches for cookies or auth (callers
// pass in the acting user's email as `actor`/`createdBy`).

import { getServiceClient } from "./supabase";

export type CompanyType = "landlord" | "tenant" | "broker" | "jv_partner" | "other";
export type ContactRole =
  | "seller"
  | "buyer"
  | "seller_broker"
  | "buyer_broker"
  | "tenant"
  | "landlord"
  | "tenant_broker"
  | "listing_broker"
  | "other";
export type ActivityType = "call" | "email" | "meeting" | "tour" | "note" | "other";

export const ROLE_LABELS: Record<string, string> = {
  seller: "Seller",
  buyer: "Buyer",
  seller_broker: "Seller broker",
  buyer_broker: "Buyer broker",
  tenant: "Tenant",
  landlord: "Landlord",
  tenant_broker: "Tenant broker",
  listing_broker: "Listing broker",
  other: "Other",
};

// Which roles make sense per pipeline -- drives the role dropdown when
// linking a contact to a deal. "other" is always available.
export const ROLES_BY_DEAL_TYPE: Record<"acquisition" | "lease", ContactRole[]> = {
  acquisition: ["seller", "buyer", "seller_broker", "buyer_broker", "other"],
  lease: ["tenant", "landlord", "tenant_broker", "listing_broker", "other"],
};

export const COMPANY_TYPE_LABELS: Record<CompanyType, string> = {
  landlord: "Landlord",
  tenant: "Tenant",
  broker: "Broker",
  jv_partner: "JV partner",
  other: "Other",
};

// -- Companies ------------------------------------------------------------

export async function listCompanies(search?: string) {
  const supabase = getServiceClient();
  let query = supabase
    .from("companies")
    .select("id, name, company_type, created_at")
    .order("name");
  if (search) query = query.ilike("name", `%${search}%`);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function createCompany(input: { name: string; companyType: CompanyType }) {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("companies")
    .insert({ name: input.name, company_type: input.companyType })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getCompanyWithRelations(companyId: string) {
  const supabase = getServiceClient();
  const [company, contacts, activities] = await Promise.all([
    supabase.from("companies").select("*").eq("id", companyId).single(),
    supabase
      .from("contacts")
      .select("id, name, email, phone, title")
      .eq("company_id", companyId)
      .order("name"),
    supabase
      .from("activities")
      .select("*")
      .eq("company_id", companyId)
      .order("occurred_at", { ascending: false }),
  ]);
  if (company.error) throw company.error;
  return {
    company: company.data,
    contacts: contacts.data ?? [],
    activities: activities.data ?? [],
  };
}

// -- Contacts -------------------------------------------------------------

export async function listContacts(search?: string) {
  const supabase = getServiceClient();
  let query = supabase
    .from("contacts")
    .select("id, name, email, phone, title, companies(id, name, company_type)")
    .order("name");
  if (search) query = query.ilike("name", `%${search}%`);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function createContact(input: {
  name: string;
  email?: string;
  phone?: string;
  title?: string;
  companyId?: string;
}) {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("contacts")
    .insert({
      name: input.name,
      email: input.email ?? null,
      phone: input.phone ?? null,
      title: input.title ?? null,
      company_id: input.companyId ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Everything the contact detail page needs, in one round of queries: the
// contact, the deals they're on (via deal_contacts), their activity history,
// and any open tasks tied to them.
export async function getContactWithRelations(contactId: string) {
  const supabase = getServiceClient();
  const [contact, dealLinks, activities, tasks] = await Promise.all([
    supabase
      .from("contacts")
      .select("*, companies(id, name, company_type)")
      .eq("id", contactId)
      .single(),
    supabase
      .from("deal_contacts")
      .select("role, deals(id, deal_type, stage, properties(address, market))")
      .eq("contact_id", contactId),
    supabase
      .from("activities")
      .select("*")
      .eq("contact_id", contactId)
      .order("occurred_at", { ascending: false }),
    supabase
      .from("tasks")
      .select("*")
      .eq("contact_id", contactId)
      .order("due_date", { ascending: true }),
  ]);
  if (contact.error) throw contact.error;
  return {
    contact: contact.data,
    deals: dealLinks.data ?? [],
    activities: activities.data ?? [],
    tasks: tasks.data ?? [],
  };
}

// -- Deal <-> contact links -----------------------------------------------

export async function linkContactToDeal(input: {
  dealId: string;
  contactId: string;
  role: ContactRole;
}) {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("deal_contacts")
    .insert({ deal_id: input.dealId, contact_id: input.contactId, role: input.role })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function unlinkContactFromDeal(linkId: string) {
  const supabase = getServiceClient();
  const { error } = await supabase.from("deal_contacts").delete().eq("id", linkId);
  if (error) throw error;
}

export async function getDealContacts(dealId: string) {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("deal_contacts")
    .select("id, role, contacts(id, name, email, phone, title, companies(name))")
    .eq("deal_id", dealId);
  if (error) throw error;
  return data ?? [];
}

// -- Activities -----------------------------------------------------------

export async function logActivity(input: {
  activityType: ActivityType;
  subject?: string;
  body?: string;
  occurredAt?: string;
  contactId?: string;
  companyId?: string;
  dealId?: string;
  propertyId?: string;
  createdBy: string;
}) {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("activities")
    .insert({
      activity_type: input.activityType,
      subject: input.subject ?? null,
      body: input.body ?? null,
      occurred_at: input.occurredAt ?? new Date().toISOString(),
      contact_id: input.contactId ?? null,
      company_id: input.companyId ?? null,
      deal_id: input.dealId ?? null,
      property_id: input.propertyId ?? null,
      created_by: input.createdBy,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function listActivitiesForDeal(dealId: string) {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("activities")
    .select("*")
    .eq("deal_id", dealId)
    .order("occurred_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// -- Tasks ----------------------------------------------------------------

export async function createTask(input: {
  title: string;
  notes?: string;
  dueDate?: string;
  assignedTo?: string;
  contactId?: string;
  companyId?: string;
  dealId?: string;
  createdBy: string;
}) {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      title: input.title,
      notes: input.notes ?? null,
      due_date: input.dueDate ?? null,
      assigned_to: input.assignedTo ?? null,
      contact_id: input.contactId ?? null,
      company_id: input.companyId ?? null,
      deal_id: input.dealId ?? null,
      created_by: input.createdBy,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function completeTask(taskId: string) {
  const supabase = getServiceClient();
  const { error } = await supabase
    .from("tasks")
    .update({ status: "done", completed_at: new Date().toISOString() })
    .eq("id", taskId);
  if (error) throw error;
}

export async function reopenTask(taskId: string) {
  const supabase = getServiceClient();
  const { error } = await supabase
    .from("tasks")
    .update({ status: "open", completed_at: null })
    .eq("id", taskId);
  if (error) throw error;
}

export async function listOpenTasksForDeal(dealId: string) {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("deal_id", dealId)
    .eq("status", "open")
    .order("due_date", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return data ?? [];
}

// Open tasks, optionally scoped to one assignee, soonest due first. Tasks with
// no due date sort last.
export async function listOpenTasks(assignedTo?: string) {
  const supabase = getServiceClient();
  let query = supabase
    .from("tasks")
    .select("*, contacts(name), deals(id, deal_type, properties(address))")
    .eq("status", "open")
    .order("due_date", { ascending: true, nullsFirst: false });
  if (assignedTo) query = query.eq("assigned_to", assignedTo);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}
