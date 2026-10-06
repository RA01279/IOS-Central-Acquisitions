import NewDealClient from "@/components/NewDealClient";
import Nav from "@/components/Nav";
import BackButton from "@/components/BackButton";

export const metadata = { title: "New Deal" };

export default function NewDealPage() {
  return (
    <>
      <Nav active="new" />
      <main>
        <BackButton />
        <h1 style={{ marginBottom: 16 }}>New deal</h1>
        <NewDealClient />
      </main>
    </>
  );
}
