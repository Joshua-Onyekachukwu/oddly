"use client";

import React from "react";
import { useScrollReveal, getScrollRevealClasses } from "@/hooks/useScrollReveal";

const testimonialsData = [
  {
    id: 1,
    quote:
      "ODDLY completely changed how I approach betting. The Crown Jewel pick alone has been incredibly consistent — I've built a 12-day rollover chain!",
    user: {
      name: "Daniel K.",
      position: "Premium Member",
    },
    stars: 5,
  },
  {
    id: 2,
    quote:
      "The accumulator builder is a game-changer. I used to build slips randomly. Now ODDLY optimizes for maximum value while managing risk across selections.",
    user: {
      name: "Sarah M.",
      position: "Elite Member",
    },
    stars: 5,
  },
  {
    id: 3,
    quote:
      "As a data analyst myself, I'm impressed by the transparency. I can see exactly which features drive each prediction and track model accuracy over time.",
    user: {
      name: "Marcus T.",
      position: "Premium Member",
    },
    stars: 5,
  },
];

const Testimonials: React.FC = () => {
  const { ref, isVisible } = useScrollReveal({ threshold: 0.05 });

  return (
    <div className="xl:max-w-[1680px] mx-auto">
      <div className="bg-[#f7f7f7] dark:bg-[#0a0e19] py-[80px] md:py-[100px] lg:py-[120px] relative z-[1] xl:rounded-[35px]">
        <div className="container sm:max-w-[540px] md:max-w-[720px] lg:max-w-[960px] xl:max-w-[1200px] mx-auto px-[16px]">
          {/* Header */}
          <div ref={ref} className="text-center mb-[48px] md:mb-[64px]">
            <div {...getScrollRevealClasses(isVisible, 0)} className="inline-flex items-center gap-[8px] mb-[16px]">
              <span className="w-[6px] h-[6px] rounded-full bg-[#BFFF00]"></span>
              <span className="text-[11px] font-semibold tracking-[0.15em] uppercase font-display text-[#1B2A4A]">
                Testimonials
              </span>
            </div>
            <h2 {...getScrollRevealClasses(isVisible, 80)} className="font-display !text-[28px] md:!text-[36px] lg:!text-[44px] !leading-[1.1] !tracking-[-0.03em] !mb-[12px] text-[#0A0F1C]">
              Trusted by Smart Bettors
            </h2>
            <p {...getScrollRevealClasses(isVisible, 160)} className="text-[15px] text-gray-500 max-w-[480px] mx-auto">
              Hear from users who are already winning smarter with ODDLY.
            </p>
          </div>

          {/* Testimonial cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-[16px]">
            {testimonialsData.map((testimonial, i) => (
              <div
                key={testimonial.id}
                {...getScrollRevealClasses(isVisible, 200 + i * 80)}
                className="bg-white rounded-[14px] p-[24px] border border-gray-100 hover:shadow-[0_4px_20px_-8px_rgba(27,42,74,0.08)] transition-all duration-500"
              >
                {/* Stars */}
                <div className="flex items-center gap-[2px] mb-[16px]">
                  {Array.from({ length: testimonial.stars }).map((_, si) => (
                    <i key={si} className="ri-star-fill text-[#D97706] text-[14px]"></i>
                  ))}
                </div>

                {/* Quote */}
                <p className="text-[14px] text-gray-600 leading-[1.7] mb-[20px]">
                  &ldquo;{testimonial.quote}&rdquo;
                </p>

                {/* User */}
                <div className="flex items-center gap-[12px] pt-[16px] border-t border-gray-50">
                  <div className="w-[36px] h-[36px] bg-[#1B2A4A] rounded-full flex items-center justify-center text-white font-semibold text-[13px] font-display">
                    {testimonial.user.name.charAt(0)}
                  </div>
                  <div>
                    <span className="text-[13px] font-semibold text-[#0A0F1C] block">
                      {testimonial.user.name}
                    </span>
                    <span className="text-[11px] text-gray-400">
                      {testimonial.user.position}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Testimonials;
