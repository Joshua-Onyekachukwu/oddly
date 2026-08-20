import Navbar from "@/components/landing/Navbar";
import HeroBanner from "@/components/landing/HeroBanner";
import Partners from "@/components/landing/Partners";
import About from "@/components/landing/About";
import Features from "@/components/landing/Features";
import DashboardShowcase from "@/components/landing/DashboardShowcase";
import Testimonials from "@/components/landing/Testimonials";
import UseCases from "@/components/landing/UseCases";
import Pricing from "@/components/landing/Pricing";
import FAQ from "@/components/landing/FAQ";
import FunFacts from "@/components/landing/FunFacts";
import LiveMatches from "@/components/landing/LiveMatches";
import GetStarted from "@/components/landing/GetStarted";
import Footer from "@/components/landing/Footer";
import { getLandingPageData } from "@/lib/landing-data";

export default async function Home() {
  // Server-side data fetching — runs on every request
  const data = await getLandingPageData();

  return (
    <>
      <Navbar />

      <HeroBanner crownJewel={data.crownJewel} stats={data.stats} />

      <Partners />

      <About />

      <Features />

      <LiveMatches fixtures={data.upcomingFixtures} valueBets={data.topValueBets} />

      <DashboardShowcase />

      <Testimonials />

      <UseCases />

      <Pricing />

      <FAQ />

      <FunFacts stats={data.stats} />

      <GetStarted />

      <Footer />
    </>
  );
}
