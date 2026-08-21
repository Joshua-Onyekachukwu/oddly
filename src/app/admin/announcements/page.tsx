"use client";

import React, { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader, Button, Card, CardHeader, Badge, EmptyState } from "@/components/ui";

interface Announcement {
  id: string;
  title: string;
  body: string;
  target: string;
  is_active: boolean;
  created_at: string;
  expires_at: string | null;
}

const TARGET_LABELS: Record<string, string> = {
  all: "All Users",
  free: "Free Tier",
  premium: "Premium",
  elite: "Elite",
};

export default function AdminAnnouncementsPage() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [formTitle, setFormTitle] = useState("");
  const [formBody, setFormBody] = useState("");
  const [formTarget, setFormTarget] = useState<"all" | "free" | "premium" | "elite">("all");

  const fetchAnnouncements = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("announcements")
      .select("*")
      .order("created_at", { ascending: false });

    if (!error && data) {
      setAnnouncements(data);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAnnouncements();
  }, [fetchAnnouncements]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    const supabase = createClient();
    const payload = {
      title: formTitle,
      body: formBody,
      target: formTarget,
      is_active: true,
    };

    if (editingId) {
      await supabase.from("announcements").update(payload).eq("id", editingId);
    } else {
      await supabase.from("announcements").insert(payload);
    }

    setShowForm(false);
    setEditingId(null);
    setFormTitle("");
    setFormBody("");
    setFormTarget("all");
    fetchAnnouncements();
    setSaving(false);
  };

  const toggleActive = async (id: string, current: boolean) => {
    const supabase = createClient();
    await supabase.from("announcements").update({ is_active: !current }).eq("id", id);
    fetchAnnouncements();
  };

  const deleteAnnouncement = async (id: string) => {
    const supabase = createClient();
    await supabase.from("announcements").delete().eq("id", id);
    fetchAnnouncements();
  };

  return (
    <div>
      <PageHeader
        title="Announcements"
        description="Create and manage platform-wide announcements."
        action={
          <Button
            onClick={() => {
              setShowForm(true);
              setEditingId(null);
              setFormTitle("");
              setFormBody("");
              setFormTarget("all");
            }}
            icon="ri-add-line"
          >
            New Announcement
          </Button>
        }
      />

      {/* Form */}
      {showForm && (
        <Card className="mb-[16px]">
          <CardHeader
            title={editingId ? "Edit Announcement" : "New Announcement"}
            action={
              <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
            }
          />
          <form onSubmit={handleSave} className="space-y-[12px]">
            <div>
              <label className="block text-[12px] font-medium text-gray-500 mb-[4px]">Title</label>
              <input
                type="text"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                required
                className="w-full h-[38px] rounded-[10px] border border-gray-200 bg-white px-[12px] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 transition-all"
              />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-gray-500 mb-[4px]">Body</label>
              <textarea
                value={formBody}
                onChange={(e) => setFormBody(e.target.value)}
                required
                rows={3}
                className="w-full rounded-[10px] border border-gray-200 bg-white px-[12px] py-[10px] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 resize-none transition-all"
              />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-gray-500 mb-[4px]">Target Audience</label>
              <select
                value={formTarget}
                onChange={(e) => setFormTarget(e.target.value as "all" | "free" | "premium" | "elite")}
                className="w-full h-[38px] rounded-[10px] border border-gray-200 bg-white px-[12px] text-[13px] focus:outline-none transition-all"
              >
                <option value="all">All Users</option>
                <option value="free">Free Tier</option>
                <option value="premium">Premium</option>
                <option value="elite">Elite</option>
              </select>
            </div>
            <div className="flex justify-end gap-[8px] pt-[4px]">
              <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={saving} icon={editingId ? "ri-save-line" : "ri-send-plane-line"}>
                {editingId ? "Update" : "Publish"}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* List */}
      {loading ? (
        <div className="space-y-[6px]">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-[64px] bg-white rounded-[10px] animate-pulse" />
          ))}
        </div>
      ) : announcements.length === 0 ? (
        <EmptyState
          icon="ri-megaphone-line"
          title="No announcements yet"
          description="Create your first announcement to notify users."
        />
      ) : (
        <div className="space-y-[6px]">
          {announcements.map((ann) => (
            <Card key={ann.id} padding="sm" className="hover:shadow-[0_2px_8px_rgba(0,0,0,0.04)] transition-shadow">
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-[8px] mb-[4px]">
                    <span className="text-[14px] font-semibold text-[#0A0F1C]">{ann.title}</span>
                    <Badge variant={ann.is_active ? "success" : "default"} size="sm">
                      {ann.is_active ? "Active" : "Inactive"}
                    </Badge>
                    <Badge variant="default" size="sm">{TARGET_LABELS[ann.target] || ann.target}</Badge>
                  </div>
                  <p className="text-[12px] text-gray-500 truncate">{ann.body}</p>
                </div>

                <div className="flex items-center gap-[6px] ml-[12px] flex-none">
                  <button
                    onClick={() => toggleActive(ann.id, ann.is_active)}
                    className={`w-[36px] h-[20px] rounded-full transition-all ${
                      ann.is_active ? "bg-green-500" : "bg-gray-200"
                    }`}
                  >
                    <span
                      className={`block w-[16px] h-[16px] bg-white rounded-full transition-all ${
                        ann.is_active ? "translate-x-[18px]" : "translate-x-[2px]"
                      }`}
                    />
                  </button>
                  <button
                    onClick={() => {
                      setEditingId(ann.id);
                      setFormTitle(ann.title);
                      setFormBody(ann.body);
                      setFormTarget(ann.target as "all" | "free" | "premium" | "elite");
                      setShowForm(true);
                    }}
                    className="w-[28px] h-[28px] rounded-[6px] flex items-center justify-center text-gray-400 hover:text-[#1B2A4A] hover:bg-gray-100 transition-colors"
                  >
                    <i className="ri-edit-line text-[14px]" />
                  </button>
                  <button
                    onClick={() => deleteAnnouncement(ann.id)}
                    className="w-[28px] h-[28px] rounded-[6px] flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                  >
                    <i className="ri-delete-bin-line text-[14px]" />
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
