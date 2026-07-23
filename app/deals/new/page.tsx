import DealForm from "@/components/DealForm";
import Nav from "@/components/Nav";
import BackButton from "@/components/BackButton";

export default function NewDealPage() {
  return (
    <>
      <Nav active="acquisitions" />
      <main>
        <BackButton />
        <h1>New deal</h1>
        <DealForm />
      </main>
    </>
  );
}
