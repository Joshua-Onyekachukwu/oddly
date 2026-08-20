"use client";

import React, { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

interface Announcement {
  id: string;
  title: string;
  body: string;
  target: string;
  is_active: boolean;
  created_at: string;
  expires_at: string | null;
}

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
      target: formTarget as "all" | "free" | "premium" | "elite",
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
      <div className="flex items-center justify-between mb-[24px]">
        <div>
          <h1 className="font-display text-[24px] md:text-[28px] font-bold text-[#0A0F1C] mb-[4px]">
            Announcements
          </h1>
          <p className="text-[14px] text-gray-500">
            Create and manage platform-wide announcements.
          </p>
        </div>
        <button
          onClick={() => {
            setShowForm(true);
            setEditingId(null);
            setFormTitle("");
            setFormBody("");
            setFormTarget("all");
          }}
          className="h-[36px] px-[16px] rounded-[10px] bg-[#1B2A4A] text-white text-[13px] font-semibold transition-all hover:bg-[#243B53] active:scale-[0.98] flex items-center gap-[6px]"
        >
          <i className="ri-add-line text-[14px]"></i>
          New Announcement
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="bg-white rounded-[16px] p-[20px] border border-gray-100 mb-[16px]">
          <h3 className="font-display text-[15px] font-semibold text-[#0A0F1C] mb-[12px]">
            {editingId ? "Edit Announcement" : "New Announcement"}
          </h3>
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
              <label className="block text-[12px] font-medium text-gray-500 mb-[4px]">Target</label>
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
            <div className="flex justify-end gap-[8px]">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="h-[36px] px-[16px] rounded-[10px] text-[13px] font-medium text-gray-500 hover:bg-gray-50 transition-all"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="h-[36px] px-[16px] rounded-[10px] bg-[#1B2A4A] text-white text-[13px] font-semibold transition-all hover:bg-[#243B53] active:scale-[0.98] disabled:opacity-50 flex items-center gap-[6px]"
              >
                {saving ? (
                  <div className="w-[14px] h-[14px] border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                ) : editingId ? (
                  "Update"
                ) : (
                  "Publish"
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="space-y-[8px]">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-[60px] bg-white rounded-[14px] animate-pulse"></div>
          ))}
        </div>
      ) : announcements.length === 0 ? (
        <div className="text-center py-[48px] bg-white rounded-[16px] border border-gray-100">
          <p className="text-[13px] text-gray-400">No announcements yet.</p>
        </div>
      ) : (
        <div className="space-y-[8px]">
          {announcements.map((ann) => (
            <div
              key={ann.id}
              className="bg-white rounded-[14px] p-[16px] border border-gray-100 shadow-[0_1px_6px_rgba(0,0,0,0.02)]"
            >
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-[8px] mb-[4px]">
                    <span className="text-[14px] font-semibold text-[#0A0F1C]">{ann.title}</span>
                    <span
                      className={`text-[10px] font-semibold px-[6px] py-[2px] rounded-full ${
                        ann.is_active ? "text-green-600 bg-green-50" : "text-gray-400 bg-gray-100"
                      }`}
                    >
                      {ann.is_active ? "Active" : "Inactive"}
                    </span>
                    <span className="text-[10px] text-gray-400 capitalize">{ann.target}</span>
                  </div>
                  <p className="text-[12px] text-gray-500 truncate">{ann.body}</p>
                </div>

                <div className="flex items-center gap-[8px] ml-[12px]">
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
                    ></span>
                  </button>
                  <button
                    onClick={() => {
                      setEditingId(ann.id);
                      setFormTitle(ann.title);
                      setFormBody(ann.body);
                      setFormTarget(ann.target as "all" | "free" | "premium" | "elite");
                      setShowForm(true);
                    }}
                    className="text-gray-400 hover:text-[#1B2A4A] transition-colors p-[4px]"
                  >
                    <i className="ri-edit-line text-[14px]"></i>
                  </button>
                  <button
                    onClick={() => deleteAnnouncement(ann.id)}
                    className="text-gray-400 hover:text-red-500 transition-colors p-[4px]"
                  >
                    <i className="ri-delete-bin-line text-[14px]"></i>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
